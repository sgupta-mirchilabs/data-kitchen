import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { StorageProvider } from "../storage/storage.interface.js";
import { parseCsv } from "./parser/csv-parser.js";
import { parseJson } from "./parser/json-parser.js";
import type { ParseResult, PreviewResult } from "./parser/parser.types.js";
import { normalizeRow, computeDataQualityStatus, type FieldMapping } from "./normalizer.js";
import { findDuplicate } from "./duplicate-resolver.js";
import { validateGtin, type ValidationIssue } from "./import-validation.js";
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
  status: "completed" | "failed";
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

  async confirmImport(
    ctx: TenantContext,
    importBatchId: string,
    fieldMappings: FieldMapping,
  ): Promise<ImportResults> {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: importBatchId, organizationId: ctx.organizationId },
    });

    if (!batch) throw new ValidationError(`Import batch not found: ${importBatchId}`);
    if (batch.status === "completed") throw new ValidationError("This import has already been completed");

    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: { status: "parsing", fieldMappings: fieldMappings as unknown as any },
    });

    const scopedStorage = createTenantScopedStorage(this.storage, ctx.organizationId);
    const fileBuffer = await scopedStorage.download(batch.fileStorageKey!);
    const content = fileBuffer.toString("utf-8");

    let parseResult: ParseResult;
    if (batch.fileType === "csv") {
      parseResult = parseCsv(content, this.config.upload.maxImportRows);
    } else {
      parseResult = parseJson(content, this.config.upload.maxImportRows);
    }

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

    for (const row of parseResult.rows) {
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

        const duplicate = await findDuplicate(
          this.prisma,
          batch.catalogId,
          normalized.sku,
          normalized.gtin,
        );

        let productId: string;
        let isUpdate = false;

        if (duplicate) {
          isUpdate = true;
          productId = duplicate.existingProductId;

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
          });

          createdProducts++;
        }

        if (hasParseWarning) {
          warningRows++;
        }
        successfulRows++;
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

    const finalStatus = failedRows === parseResult.rows.length ? "failed" : "completed";

    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: {
        status: finalStatus,
        successfulRows,
        warningRows,
        failedRows,
        errorSummary: (errors.length > 0 || rowValidationIssues.length > 0)
          ? { errors, warnings, validationIssues: rowValidationIssues } as unknown as any
          : undefined,
      },
    });

    return {
      importBatchId,
      status: finalStatus,
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
