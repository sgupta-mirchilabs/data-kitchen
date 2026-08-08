import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { StorageProvider } from "../storage/storage.interface.js";
import { parseCsv } from "./parser/csv-parser.js";
import { parseJson } from "./parser/json-parser.js";
import type { ParseResult, PreviewResult } from "./parser/parser.types.js";
import { type FieldMapping } from "./normalizer.js";
import { resolveImportMatches } from "./import-matching.js";
import {
  EXISTING_PRODUCT_SELECT,
  buildChunkPlan,
  indexParseWarnings,
  matchRowFromPrepared,
  prepareRow,
  sliceForInsert,
  type ChunkPlan,
  type ExistingProductSnapshot,
  type PreparedRow,
} from "./import-chunk.js";
import { type ValidationIssue } from "./import-validation.js";
import { advanceProgress, heartbeat, isCancellationRequested } from "../jobs/import-job.repository.js";
import { transition } from "../jobs/import-job.repository.js";
import { isTerminal, type ImportState } from "../jobs/import-state.js";
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

/**
 * Where an import's wall clock went. Recorded per run so a throughput claim is
 * always attributable to a phase rather than to "the import".
 */
export interface ImportTimings {
  /** Downloading the source file from blob storage. */
  blobMs: number;
  parseMs: number;
  /** Batched match resolution — one query per chunk. */
  matchMs: number;
  /** Reading the products a chunk will update. */
  readMs: number;
  /** Building chunk plans in memory. */
  planMs: number;
  /** Canonical product writes: bulk creates plus per-product updates. */
  canonicalMs: number;
  sourceMs: number;
  provenanceMs: number;
  historyMs: number;
  /** Advancing the resume pointer inside the chunk transaction. */
  progressMs: number;
  /** Total time inside chunk transactions. */
  commitMs: number;
  chunks: number;
  chunkSize: number;
  /** Chunks that failed in bulk and were retried a row at a time. */
  isolatedChunks: number;
  peakHeapMb: number;
  peakRssMb: number;
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
  /** Matched rows whose product already held every value the row carried. */
  unchangedProducts: number;
  timings: ImportTimings;
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

/**
 * A chunk transaction holds locks for as long as it runs, so these are sized to
 * be generous rather than tight: the default 5s Prisma timeout is a limit on a
 * single interactive transaction, and a chunk against a remote burstable
 * instance can legitimately exceed it. Exceeding these means something is
 * genuinely wrong, and the chunk should roll back.
 */
const CHUNK_TX_TIMEOUT_MS = 120_000;
const CHUNK_TX_MAX_WAIT_MS = 20_000;

/** Run-level accumulators, threaded through chunk commits. */
interface RunTotals {
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  createdProducts: number;
  updatedProducts: number;
  unchangedProducts: number;
  warnings: Array<{ rowNumber?: number; message: string }>;
  errors: Array<{ rowNumber?: number; message: string }>;
  validationIssues: Array<{ rowNumber: number } & ValidationIssue>;
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
   * Increment B replaced the per-row transaction with a per-chunk one. A chunk
   * is planned entirely in memory — one batched match query, one read of the
   * products it will update — and then committed as a single transaction whose
   * last statement advances the resume pointer. Progress therefore still means
   * exactly what it meant in Increment A: the highest FULLY committed source
   * row. A chunk that fails rolls back its writes and its progress together.
   *
   * Row-level fault isolation survives the change. If a chunk's bulk commit
   * fails, it is retried one row at a time, so a single unimportable row costs
   * its own row rather than the ninety-nine around it.
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

    const startedAt = Date.now();
    const totals: RunTotals = {
      successfulRows: 0, warningRows: 0, failedRows: 0,
      createdProducts: 0, updatedProducts: 0, unchangedProducts: 0,
      warnings: [], errors: [], validationIssues: [],
    };

    for (const warning of parseResult.warnings) {
      totals.warnings.push({ rowNumber: warning.rowNumber, message: warning.message });
    }

    const chunkSize = Math.max(1, opts.chunkSize || this.config.imports.chunkSize);
    const timings: ImportTimings = {
      blobMs, parseMs, matchMs: 0, readMs: 0, planMs: 0, canonicalMs: 0,
      sourceMs: 0, provenanceMs: 0, historyMs: 0, progressMs: 0, commitMs: 0,
      chunks: 0, chunkSize, isolatedChunks: 0, peakHeapMb: 0, peakRssMb: 0,
    };

    // Rows at or below committed progress were durably applied by a prior
    // attempt. The (import_batch_id, row_number) unique index remains a
    // defensive backstop, not the mechanism relied on here.
    //
    // Normalization and validation happen up front for the whole file: they are
    // pure CPU work, they were never the bottleneck, and doing them here keeps
    // the chunk loop to database work only.
    const warningsByRow = indexParseWarnings(parseResult.warnings);
    const pending = parseResult.rows
      .filter((row) => row.rowNumber > resumeFrom)
      .map((row) => prepareRow(row, fieldMappings, warningsByRow.get(row.rowNumber) ?? []));

    let cancelled = false;
    // Heartbeat at roughly a third of the lease so a slow chunk cannot let the
    // lease lapse, and always on the last chunk so a short file still reports.
    const livenessIntervalMs = Math.max(2000, Math.floor(opts.leaseMs / 3));
    let lastLivenessAt = Date.now();

    for (let offset = 0; offset < pending.length; offset += chunkSize) {
      const slice = pending.slice(offset, offset + chunkSize);
      const isFinalChunk = offset + slice.length >= pending.length;

      try {
        const plan = await this.commitChunk(batch, ctx.displayName, slice, timings);
        this.tallyChunk(slice, plan, totals);
      } catch (err) {
        if (slice.length === 1) {
          await this.recordFailedRow(batch.id, slice[0], err, totals);
        } else {
          // Fault isolation. The bulk attempt rolled back in full, so replay the
          // chunk one row at a time and charge the failure to the row that
          // caused it rather than to the ninety-nine around it. This is what
          // keeps Increment A's per-row tolerance intact under chunking.
          timings.isolatedChunks++;
          log({ event: "import.chunk_isolating", importBatchId,
                fromRow: slice[0].rowNumber, rows: slice.length,
                message: err instanceof Error ? err.message : String(err) });

          for (const row of slice) {
            try {
              const plan = await this.commitChunk(batch, ctx.displayName, [row], timings);
              this.tallyChunk([row], plan, totals);
            } catch (rowErr) {
              await this.recordFailedRow(batch.id, row, rowErr, totals);
            }
          }
        }
      }

      timings.chunks++;
      const mem = process.memoryUsage();
      timings.peakHeapMb = Math.max(timings.peakHeapMb, Math.round(mem.heapUsed / 1048576));
      timings.peakRssMb = Math.max(timings.peakRssMb, Math.round(mem.rss / 1048576));

      // Liveness and cancellation stay time-based rather than chunk-modulo, so
      // a file smaller than one chunk still heartbeats and still honours a
      // cancellation request.
      if (Date.now() - lastLivenessAt >= livenessIntervalMs || isFinalChunk) {
        const stillOwned = await heartbeat(this.prisma, importBatchId, opts.workerId, opts.leaseMs);
        log({ event: "import.progress", importBatchId,
              throughRow: slice[slice.length - 1].rowNumber,
              chunks: timings.chunks,
              sinceLastMs: Date.now() - lastLivenessAt,
              heapUsedMb: Math.round(mem.heapUsed / 1048576) });
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
    }

    const {
      successfulRows, warningRows, failedRows, createdProducts, updatedProducts,
      unchangedProducts, warnings, errors,
    } = totals;
    const rowValidationIssues = totals.validationIssues;

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

    // Kept on the batch so an operator investigating a slow import can see
    // where its time went without re-running it. Best-effort: losing the
    // measurement must never fail an import that succeeded.
    await this.prisma.importBatch.update({
      where: { id: importBatchId },
      data: {
        parseMetadata: {
          ...((batch.parseMetadata ?? {}) as Record<string, unknown>),
          timings: { ...timings, totalMs: Date.now() - startedAt },
        } as unknown as any,
      },
    }).catch(() => {});

    log({ event: "import.finished", importBatchId, status: finalStatus,
          rows: parseResult.rows.length, successfulRows, failedRows,
          createdProducts, updatedProducts, unchangedProducts,
          chunks: timings.chunks, chunkSize: timings.chunkSize,
          isolatedChunks: timings.isolatedChunks,
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
      unchangedProducts,
      timings,
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

  /**
   * Resolves, plans and commits one chunk.
   *
   * Two round trips before the transaction — the batched match query and one
   * read of the products the chunk will update — and then a single transaction
   * containing every write the chunk performs, ending with the resume pointer.
   * If it throws, nothing in the chunk was committed, progress included.
   */
  private async commitChunk(
    batch: { id: string; organizationId: string; catalogId: string },
    actor: string,
    rows: PreparedRow[],
    timings: ImportTimings,
  ): Promise<ChunkPlan> {
    const matchStart = Date.now();
    const resolved = await resolveImportMatches(
      this.prisma,
      { catalogId: batch.catalogId, organizationId: batch.organizationId },
      rows.map(matchRowFromPrepared),
    );
    timings.matchMs += Date.now() - matchStart;

    const updateIds = [...new Set(
      resolved
        .filter((r) => r.target.kind === "existing")
        .map((r) => (r.target as { productId: string }).productId),
    )];

    const readStart = Date.now();
    const existingRows = updateIds.length
      ? await this.prisma.canonicalProduct.findMany({
          // The ids came from an already-scoped query; scoping the read as well
          // costs nothing and means no single mistake can reach another tenant.
          where: {
            id: { in: updateIds },
            catalogId: batch.catalogId,
            organizationId: batch.organizationId,
          },
          select: EXISTING_PRODUCT_SELECT,
        })
      : [];
    timings.readMs += Date.now() - readStart;

    const existing = new Map<string, ExistingProductSnapshot>(
      existingRows.map((p) => [
        p.id,
        { ...p, attributes: (p.attributes ?? {}) as Record<string, unknown> },
      ]),
    );

    const planStart = Date.now();
    const plan = buildChunkPlan({
      importBatchId: batch.id,
      organizationId: batch.organizationId,
      catalogId: batch.catalogId,
      actor,
      rows,
      resolved,
      existing,
    });
    timings.planMs += Date.now() - planStart;

    const commitStart = Date.now();
    await this.prisma.$transaction(async (tx) => {
      let phase = Date.now();
      for (const slice of sliceForInsert(plan.creates)) {
        await tx.canonicalProduct.createMany({ data: slice });
      }
      // Updates remain one statement per changed product. The update shape is
      // per-row — which columns appear depends on which fields the row carried
      // — so batching them means either a synthetic VALUES join or overwriting
      // columns the row never mentioned. Correctness first: the saving that
      // matters is that unchanged products produce no statement at all.
      for (const update of plan.updates) {
        await tx.canonicalProduct.update({ where: { id: update.id }, data: update.data });
      }
      timings.canonicalMs += Date.now() - phase;

      phase = Date.now();
      for (const slice of sliceForInsert(plan.sourceRecords)) {
        await tx.sourceRecord.createMany({ data: slice });
      }
      timings.sourceMs += Date.now() - phase;

      phase = Date.now();
      for (const slice of sliceForInsert(plan.provenance)) {
        await tx.fieldProvenance.createMany({ data: slice });
      }
      timings.provenanceMs += Date.now() - phase;

      phase = Date.now();
      for (const slice of sliceForInsert(plan.history)) {
        await tx.canonicalProductHistory.createMany({ data: slice });
      }
      timings.historyMs += Date.now() - phase;

      // Last, and in the same transaction: progress cannot claim work that has
      // not committed, because it commits with it.
      phase = Date.now();
      await advanceProgress(tx, batch.id, plan.lastRowNumber);
      timings.progressMs += Date.now() - phase;
    }, { maxWait: CHUNK_TX_MAX_WAIT_MS, timeout: CHUNK_TX_TIMEOUT_MS });
    timings.commitMs += Date.now() - commitStart;

    return plan;
  }

  /**
   * Counts a chunk, and only once it has committed.
   *
   * Deliberately after the write rather than during planning: a chunk that
   * fails is replayed a row at a time, and each replayed row tallies itself.
   * Tallying earlier would double-count every isolated chunk.
   */
  private tallyChunk(rows: PreparedRow[], plan: ChunkPlan, totals: RunTotals): void {
    for (const row of rows) {
      for (const issue of row.validationIssues) {
        totals.warnings.push({ rowNumber: row.rowNumber, message: issue.message });
        totals.validationIssues.push({ rowNumber: row.rowNumber, ...issue });
      }
      // One warning row per row that carried a warning of either kind, so the
      // persisted count agrees with the warnings the summary lists.
      if (row.hasParseWarning || row.validationIssues.length > 0) totals.warningRows++;
      totals.successfulRows++;
    }
    totals.createdProducts += plan.createdProducts;
    totals.updatedProducts += plan.updatedProducts;
    totals.unchangedProducts += plan.unchangedProducts;
  }

  /**
   * Records a row that could not be committed even on its own.
   *
   * The error source record is diagnostic and best-effort: failing to write it
   * must not turn one bad row into a failed import. Progress is not advanced
   * past the row here — the next chunk to commit advances past it, which is
   * what makes a permanently bad row cost one row rather than stall the import.
   */
  private async recordFailedRow(
    importBatchId: string,
    row: PreparedRow,
    err: unknown,
    totals: RunTotals,
  ): Promise<void> {
    totals.failedRows++;
    const message = err instanceof Error ? err.message : String(err);
    totals.errors.push({ rowNumber: row.rowNumber, message: `Row ${row.rowNumber}: ${message}` });

    await this.prisma.sourceRecord.create({
      data: {
        importBatchId,
        rowNumber: row.rowNumber,
        sourceRecordKey: null,
        rawPayloadJson: row.raw as unknown as any,
        parseStatus: "error",
        parseErrorsJson: [{ message }] as unknown as any,
      },
    }).catch(() => {});
  }
}
