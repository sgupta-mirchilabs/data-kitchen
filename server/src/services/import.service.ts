import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { StorageProvider } from "../storage/storage.interface.js";
import { parseCsv } from "./parser/csv-parser.js";
import { parseJson } from "./parser/json-parser.js";
import type { ParseResult, PreviewResult } from "./parser/parser.types.js";
import { normalizeRow, computeDataQualityStatus, type FieldMapping } from "./normalizer.js";
import { resolveImportMatches } from "./import-matching.js";
import { validateGtin, type ValidationIssue } from "./import-validation.js";
import { advanceProgress, heartbeat, isCancellationRequested } from "../jobs/import-job.repository.js";
import { transition } from "../jobs/import-job.repository.js";
import { isTerminal, type ImportState } from "../jobs/import-state.js";
import { diffProductFields, serializeHistoryValue } from "./history.js";
import { ParseError, ValidationError } from "../errors/api-errors.js";
import type { AppConfig } from "../config.js";
import type { TenantContext } from "../auth/types.js";
import { buildTenantStorageKey, createTenantScopedStorage } from "../storage/tenant-scoped-storage.js";

export interface UploadResult {
  importBatchId: string;
  preview: PreviewResult;
  /**
   * Every parsed row, not just the preview sample. Used server-side for
   * whole-file checks such as duplicate-key detection; never returned to the
   * client, which only receives preview.sampleRows.
   */
  allRows: Array<{ rowNumber: number; data: Record<string, string> }>;
}

export interface ImportResults {
  importBatchId: string;
  status: "completed" | "completed_with_warnings" | "failed" | "cancelled";
  totalRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  createdProducts: number;
  updatedProducts: number;
  warnings: Array<{ rowNumber?: number; message: string }>;
  errors: Array<{ rowNumber?: number; message: string }>;
  /** Identifier validation issues, for the summary and Product Detail. */
  validationIssues: Array<{ rowNumber: number } & ValidationIssue>;
  /** Rows parsed but not turned into a product (currently always 0). */
  skippedRows: number;
  /** Wall-clock time for the confirm phase. */
  durationMs: number;
  filename: string;
  catalogId: string;
  organizationId: string;
}

function detectFileType(filename: string): "csv" | "json" {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "json") return "json";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  throw new ValidationError(`Unsupported file type: .${ext}. Supported formats: .csv, .tsv, .json`);
}

export class ImportService {
  constructor(
    private prisma: PrismaClient,
    private storage: StorageProvider,
    private config: AppConfig,
  ) {}

  async uploadAndPreview(
    ctx: TenantContext,
    catalogId: string,
    filename: string,
    fileBuffer: Buffer,
    sourceSystem?: string,
  ): Promise<UploadResult> {
    const fileType = detectFileType(filename);
    const checksum = createHash("sha256").update(fileBuffer).digest("hex");

    const tempImportId = `pre-${Date.now()}`;
    const storageKey = buildTenantStorageKey(ctx.organizationId, catalogId, tempImportId, filename);
    const scopedStorage = createTenantScopedStorage(this.storage, ctx.organizationId);

    await scopedStorage.upload(storageKey, fileBuffer, fileType === "json" ? "application/json" : "text/csv");

    const content = fileBuffer.toString("utf-8");
    let parseResult: ParseResult;

    if (fileType === "csv") {
      parseResult = parseCsv(content, this.config.upload.maxImportRows);
    } else {
      parseResult = parseJson(content, this.config.upload.maxImportRows);
    }

    const batch = await this.prisma.importBatch.create({
      data: {
        organizationId: ctx.organizationId,
        catalogId,
        filename,
        fileType,
        sourceSystem: sourceSystem ?? null,
        uploadedBy: ctx.displayName,
        status: "uploaded",
        totalRows: parseResult.metadata.totalRows,
        fileStorageKey: storageKey,
        fileChecksum: checksum,
        detectedHeaders: parseResult.headers as unknown as any,
        parseMetadata: parseResult.metadata as unknown as any,
      },
    });

    const sampleRows = parseResult.rows.slice(0, 20);

    return {
      importBatchId: batch.id,
      allRows: parseResult.rows,
      preview: {
        headers: parseResult.headers,
        sampleRows,
        totalRows: parseResult.metadata.totalRows,
        warnings: parseResult.warnings,
        metadata: parseResult.metadata,
      },
    };
  }

  /**
   * Durably accepts a confirmed import and returns immediately.
   *
   * Everything after this point is the worker's responsibility, so once this
   * resolves the operator may close the browser without affecting the run.
   */
  async enqueueImport(
    ctx: TenantContext,
    importBatchId: string,
    fieldMappings: FieldMapping,
  ): Promise<{ importBatchId: string; status: string; totalRows: number; catalogId: string; organizationId: string }> {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: importBatchId, organizationId: ctx.organizationId },
    });

    if (!batch) throw new ValidationError(`Import batch not found: ${importBatchId}`);
    if (isTerminal(batch.status)) {
      throw new ValidationError(`This import is already ${batch.status.replace(/_/g, " ")}.`);
    }
    if (batch.status === "queued" || batch.status === "processing") {
      throw new ValidationError("This import is already in progress.");
    }

    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: { fieldMappings: fieldMappings as unknown as any },
    });
    await transition(this.prisma, importBatchId, "queued", { progressRows: 0 });

    return {
      importBatchId,
      status: "queued",
      totalRows: batch.totalRows,
      catalogId: batch.catalogId,
      organizationId: batch.organizationId,
    };
  }

  /**
   * Executes a leased import. Called only by the worker.
   *
   * Organization and catalog are taken from the persisted batch, never from a
   * caller, so a background run carries the same tenant guarantees as a
   * request-bound one.
   *
   * The per-row commit logic below is deliberately unchanged from the
   * synchronous pipeline (Increment A does not rewrite it). What is new is the
   * surrounding chunk loop: heartbeat, cancellation checks, and progress that
   * advances inside a row transaction so it can never exceed committed work.
   */
  async executeImport(
    importBatchId: string,
    opts: { workerId: string; leaseMs: number; chunkSize: number; log?: (e: Record<string, unknown>) => void },
  ): Promise<ImportResults> {
    const log = opts.log ?? (() => {});
    const batch = await this.prisma.importBatch.findUnique({ where: { id: importBatchId } });
    if (!batch) throw new ValidationError(`Import batch not found: ${importBatchId}`);

    const fieldMappings = (batch.fieldMappings ?? {}) as FieldMapping;
    const ctx = { displayName: batch.uploadedBy ?? "system:import" } as TenantContext;
    const resumeFrom = batch.progressRows ?? 0;

    const scopedStorage = createTenantScopedStorage(this.storage, batch.organizationId);
    const blobStart = Date.now();
    const fileBuffer = await scopedStorage.download(batch.fileStorageKey!);
    const content = fileBuffer.toString("utf-8");
    const blobMs = Date.now() - blobStart;

    const parseStart = Date.now();
    let parseResult: ParseResult;
    if (batch.fileType === "csv") {
      parseResult = parseCsv(content, this.config.upload.maxImportRows);
    } else {
      parseResult = parseJson(content, this.config.upload.maxImportRows);
    }
    const parseMs = Date.now() - parseStart;
    log({ event: "import.parsed", importBatchId, rows: parseResult.rows.length, blobMs, parseMs,
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576), resumeFrom });

    let successfulRows = 0;
    let warningRows = 0;
    let failedRows = 0;
    let createdProducts = 0;
    let updatedProducts = 0;
    const startedAt = Date.now();
    const warnings: Array<{ rowNumber?: number; message: string }> = [];
    const rowValidationIssues: Array<{ rowNumber: number } & ValidationIssue> = [];
    const errors: Array<{ rowNumber?: number; message: string }> = [];

    for (const warning of parseResult.warnings) {
      warnings.push({ rowNumber: warning.rowNumber, message: warning.message });
    }

    let cancelled = false;
    // Heartbeat at roughly a third of the lease so a slow row cannot let the
    // lease lapse, and always on the final row so a short file still reports.
    const livenessIntervalMs = Math.max(2000, Math.floor(opts.leaseMs / 3));
    let lastLivenessAt = Date.now();
    const lastRowNumber = parseResult.rows.length > 0
      ? parseResult.rows[parseResult.rows.length - 1].rowNumber
      : 0;

    for (const row of parseResult.rows) {
      // Resume: rows below committed progress were durably applied by a prior
      // attempt. The (import_batch_id, row_number) unique index remains a
      // defensive backstop, not the mechanism relied on here.
      if (row.rowNumber <= resumeFrom) continue;

      try {
        const { product: normalized, provenance } = normalizeRow(row.data, fieldMappings);
        const qualityStatus = computeDataQualityStatus(normalized);

        const hasParseWarning = parseResult.warnings.some((w) => w.rowNumber === row.rowNumber);

        // Lightweight identifier validation (KI-2). Never fails the row — an
        // invalid GTIN still imports, but is surfaced and marked for review
        // instead of being accepted silently.
        const validationIssues: ValidationIssue[] = validateGtin(
          normalized.gtin,
          fieldMappings.gtin,
        );
        for (const issue of validationIssues) {
          warnings.push({ rowNumber: row.rowNumber, message: issue.message });
          rowValidationIssues.push({ rowNumber: row.rowNumber, ...issue });
        }

        const effectiveStatus = hasParseWarning
          ? "parse_warning"
          : validationIssues.length > 0
            ? "needs_review"
            : qualityStatus;

        // Count the row once if it carried any identifier warning, so the
        // persisted warningRows agrees with the warnings actually reported.
        // Without this the batch records 0 while the summary lists several.
        if (!hasParseWarning && validationIssues.length > 0) warningRows++;

        // One shared matcher for preview and commit. Still one call per row at
        // this point — Increment B batches it per chunk next; what changes here
        // is only that the rule lives in one place.
        const [resolvedRow] = await resolveImportMatches(
          this.prisma,
          { catalogId: batch.catalogId, organizationId: batch.organizationId },
          [{ rowNumber: row.rowNumber, sku: normalized.sku, gtin: normalized.gtin }],
        );
        const duplicate = resolvedRow.target.kind === "existing" ? resolvedRow.target : null;

        let productId: string;
        let isUpdate = false;

        if (duplicate) {
          isUpdate = true;
          productId = duplicate.productId;

          const existing = await this.prisma.canonicalProduct.findUnique({
            where: { id: productId },
          });

          if (existing) {
            const updateData: Record<string, unknown> = {};
            const incomingFields: Record<string, unknown> = {};

            if (normalized.sku) { updateData.sku = normalized.sku; incomingFields.sku = normalized.sku; }
            if (normalized.gtin) { updateData.gtin = normalized.gtin; incomingFields.gtin = normalized.gtin; }
            if (normalized.brand) { updateData.brand = normalized.brand; incomingFields.brand = normalized.brand; }
            if (normalized.productName) { updateData.productName = normalized.productName; incomingFields.product_name = normalized.productName; }
            if (normalized.shortDescription) { updateData.shortDescription = normalized.shortDescription; incomingFields.short_description = normalized.shortDescription; }
            if (normalized.longDescription) { updateData.longDescription = normalized.longDescription; incomingFields.long_description = normalized.longDescription; }
            if (normalized.category) { updateData.category = normalized.category; incomingFields.category = normalized.category; }
            if (normalized.manufacturer) { updateData.manufacturer = normalized.manufacturer; incomingFields.manufacturer = normalized.manufacturer; }

            if (Object.keys(normalized.attributes).length > 0) {
              const mergedAttributes = { ...(existing.attributes as Record<string, unknown>), ...normalized.attributes };
              updateData.attributes = mergedAttributes;
            }

            const existingFields: Record<string, unknown> = {
              sku: existing.sku,
              gtin: existing.gtin,
              brand: existing.brand,
              product_name: existing.productName,
              short_description: existing.shortDescription,
              long_description: existing.longDescription,
              category: existing.category,
              manufacturer: existing.manufacturer,
            };

            const historyChanges = diffProductFields(existingFields, incomingFields);

            updateData.dataQualityStatus = effectiveStatus;
            updateData.updatedBy = ctx.displayName;

            await this.prisma.$transaction(async (tx) => {
              await tx.canonicalProduct.update({
                where: { id: productId },
                data: updateData,
              });

              const sourceRecord = await tx.sourceRecord.create({
                data: {
                  importBatchId: batch.id,
                  rowNumber: row.rowNumber,
                  sourceRecordKey: normalized.sku ?? normalized.gtin ?? null,
                  rawPayloadJson: row.data as unknown as any,
                  parseStatus: hasParseWarning ? "warning" : "success",
                  parseErrorsJson: hasParseWarning
                    ? parseResult.warnings.filter((w) => w.rowNumber === row.rowNumber) as unknown as any
                    : undefined,
                  canonicalProductId: productId,
                },
              });

              for (const p of provenance) {
                await tx.fieldProvenance.create({
                  data: {
                    canonicalProductId: productId,
                    canonicalField: p.canonicalField,
                    sourceRecordId: sourceRecord.id,
                    sourceField: p.sourceField,
                    originalValue: p.originalValue,
                    normalizedValue: p.normalizedValue,
                    normalizationMethod: p.normalizationMethod,
                  },
                });
              }

              for (const change of historyChanges) {
                await tx.canonicalProductHistory.create({
                  data: {
                    canonicalProductId: productId,
                    field: change.field,
                    previousValue: change.previousValue,
                    newValue: change.newValue,
                    sourceRecordId: sourceRecord.id,
                    actor: `system:import`,
                  },
                });
              }

              // Resume pointer advances with the row's own writes. If this
              // transaction rolls back the pointer rolls back with it, so
              // progress_rows is always the highest FULLY committed row.
              await advanceProgress(tx, importBatchId, row.rowNumber);
            });

            updatedProducts++;
          }
        } else {
          await this.prisma.$transaction(async (tx) => {
            const matchStatus = (normalized.sku === null && normalized.gtin === null)
              ? "needs_review"
              : effectiveStatus;

            const product = await tx.canonicalProduct.create({
              data: {
                organizationId: batch.organizationId,
                catalogId: batch.catalogId,
                sku: normalized.sku,
                gtin: normalized.gtin,
                brand: normalized.brand,
                productName: normalized.productName,
                shortDescription: normalized.shortDescription,
                longDescription: normalized.longDescription,
                category: normalized.category,
                manufacturer: normalized.manufacturer,
                lifecycleStatus: "draft",
                dataQualityStatus: validationIssues.length > 0 ? "needs_review" : matchStatus,
                attributes: (normalized.attributes ?? {}) as unknown as any,
                createdBy: ctx.displayName,
                updatedBy: ctx.displayName,
              },
            });

            productId = product.id;

            const sourceRecord = await tx.sourceRecord.create({
              data: {
                importBatchId: batch.id,
                rowNumber: row.rowNumber,
                sourceRecordKey: normalized.sku ?? normalized.gtin ?? null,
                rawPayloadJson: row.data as unknown as any,
                parseStatus: hasParseWarning ? "warning" : "success",
                parseErrorsJson: hasParseWarning
                  ? parseResult.warnings.filter((w) => w.rowNumber === row.rowNumber) as unknown as any
                  : undefined,
                canonicalProductId: product.id,
              },
            });

            for (const p of provenance) {
              await tx.fieldProvenance.create({
                data: {
                  canonicalProductId: product.id,
                  canonicalField: p.canonicalField,
                  sourceRecordId: sourceRecord.id,
                  sourceField: p.sourceField,
                  originalValue: p.originalValue,
                  normalizedValue: p.normalizedValue,
                  normalizationMethod: p.normalizationMethod,
                },
              });
            }

            // See the update path: the resume pointer is part of the row's
            // transaction, not a separate write.
            await advanceProgress(tx, importBatchId, row.rowNumber);
          });

          createdProducts++;
        }

        if (hasParseWarning) {
          warningRows++;
        }
        successfulRows++;

        // Liveness and cancellation are time-based, not row-modulo. A file
        // smaller than one chunk previously never reached a boundary, so it
        // never heartbeat and never checkpointed. Progress no longer depends on
        // this block at all — it is committed with each row above.
        const isFinalRow = row.rowNumber === lastRowNumber;
        if (Date.now() - lastLivenessAt >= livenessIntervalMs || isFinalRow) {
          const stillOwned = await heartbeat(this.prisma, importBatchId, opts.workerId, opts.leaseMs);
          log({ event: "import.progress", importBatchId, throughRow: row.rowNumber,
                sinceLastMs: Date.now() - lastLivenessAt,
                heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576) });
          lastLivenessAt = Date.now();

          // Losing the lease means another worker reclaimed this job; stopping
          // immediately avoids two workers committing the same import.
          if (!stillOwned) {
            log({ event: "import.lease_lost", importBatchId, workerId: opts.workerId });
            throw new Error("Lease lost; another worker has taken over this import");
          }

          if (await isCancellationRequested(this.prisma, importBatchId)) {
            cancelled = true;
            break;
          }
        }
      } catch (err) {
        failedRows++;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ rowNumber: row.rowNumber, message: `Row ${row.rowNumber}: ${message}` });

        await this.prisma.sourceRecord.create({
          data: {
            importBatchId: batch.id,
            rowNumber: row.rowNumber,
            sourceRecordKey: null,
            rawPayloadJson: row.data as unknown as any,
            parseStatus: "error",
            parseErrorsJson: [{ message }] as unknown as any,
          },
        }).catch(() => {});
      }
    }

    const processedRows = parseResult.rows.length - resumeFrom;
    const finalStatus: ImportState = cancelled
      ? "cancelled"
      : processedRows > 0 && failedRows === processedRows
        ? "failed"
        : warnings.length > 0 || warningRows > 0
          ? "completed_with_warnings"
          : "completed";

    await transition(this.prisma, importBatchId, finalStatus, {
      successfulRows,
      warningRows,
      failedRows,
      progressRows: parseResult.rows.length,
      releaseLease: true,
      ...(finalStatus === "failed"
        ? { errorCode: "ALL_ROWS_FAILED", errorMessage: `All ${failedRows} rows failed to import.` }
        : {}),
      ...((errors.length > 0 || rowValidationIssues.length > 0)
        ? { errorSummary: { errors, warnings, validationIssues: rowValidationIssues } as unknown as any }
        : {}),
    });

    log({ event: "import.finished", importBatchId, status: finalStatus,
          rows: parseResult.rows.length, successfulRows, failedRows,
          durationMs: Date.now() - startedAt, cancelled });

    return {
      importBatchId,
      status: finalStatus as ImportResults["status"],
      totalRows: parseResult.rows.length,
      successfulRows,
      warningRows,
      failedRows,
      createdProducts,
      updatedProducts,
      warnings,
      errors,
      validationIssues: rowValidationIssues,
      skippedRows: parseResult.rows.length - successfulRows - failedRows,
      durationMs: Date.now() - startedAt,
      filename: batch.filename,
      catalogId: batch.catalogId,
      organizationId: batch.organizationId,
    };
  }
}
