import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  normalizeRow,
  computeDataQualityStatus,
  type FieldMapping,
  type NormalizedProduct,
  type ProvenanceEntry,
} from "./normalizer.js";
import { validateGtin, type ValidationIssue } from "./import-validation.js";
import { diffProductFields } from "./history.js";
import { targetKey, type ResolvedRow } from "./import-matching.js";
import type { ParseWarning } from "./parser/parser.types.js";

/**
 * Chunk planning for imports (Phase 1.0.2, Increment B).
 *
 * Increment A committed one transaction per row: a match query, a product read,
 * a product write, a source record, one insert per provenance entry, one per
 * history entry, and the resume pointer — roughly twelve statements for every
 * row in the file. Throughput was 3.4 rows/sec at both 100 and 500 rows, which
 * is the signature of work that scales with rows rather than with data.
 *
 * A chunk is now planned entirely in memory and committed as one transaction.
 * Database work scales with the number of chunks; only the canonical UPDATE
 * statements still scale with the number of rows that actually change something,
 * and that is deliberate — see `buildChunkPlan`.
 *
 * Two things had to become explicit that the serial loop got for free:
 *
 *   1. A product created by an early row is visible to a later row. The matcher
 *      handles that (see `import-matching.ts`); here it means the plan may
 *      create a product and then update it within one chunk.
 *
 *   2. Rows touching the same product must see each other's writes. History is
 *      diffed against the state left by the previous row, not against the
 *      snapshot read from the database, so a field changed twice in one chunk
 *      produces two history entries with a continuous chain of values.
 *
 * Planning is pure. It takes the rows, the resolved matches and a snapshot of
 * the products being updated, and returns the writes to perform. That is what
 * makes the semantics testable without a database.
 */

/** A row normalized and validated, before anything is known about matching. */
export interface PreparedRow {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: NormalizedProduct;
  provenance: ProvenanceEntry[];
  hasParseWarning: boolean;
  parseErrors: ParseWarning[];
  validationIssues: ValidationIssue[];
  /** The data-quality status this row would apply. */
  effectiveStatus: string;
}

/** The columns of an existing product that an update reads. */
export interface ExistingProductSnapshot {
  id: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  productName: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  manufacturer: string | null;
  attributes: Record<string, unknown>;
  dataQualityStatus: string;
  updatedBy: string | null;
}

export const EXISTING_PRODUCT_SELECT = {
  id: true, sku: true, gtin: true, brand: true, productName: true,
  shortDescription: true, longDescription: true, category: true,
  manufacturer: true, attributes: true, dataQualityStatus: true, updatedBy: true,
} as const;

export interface ChunkPlan {
  creates: Prisma.CanonicalProductCreateManyInput[];
  /** One entry per product that actually changes; UNCHANGED rows produce none. */
  updates: Array<{ id: string; data: Prisma.CanonicalProductUpdateInput }>;
  sourceRecords: Prisma.SourceRecordCreateManyInput[];
  provenance: Prisma.FieldProvenanceCreateManyInput[];
  history: Prisma.CanonicalProductHistoryCreateManyInput[];
  /** Highest row number in the chunk — the resume pointer after it commits. */
  lastRowNumber: number;
  createdProducts: number;
  updatedProducts: number;
  /** Matched rows whose product needed no write at all. */
  unchangedProducts: number;
  /** Rows whose matched product vanished between resolve and read. */
  vanishedRows: number;
}

export interface ChunkPlanInput {
  importBatchId: string;
  organizationId: string;
  catalogId: string;
  /** Recorded as created_by / updated_by; history keeps its own fixed actor. */
  actor: string;
  rows: PreparedRow[];
  resolved: ResolvedRow[];
  existing: Map<string, ExistingProductSnapshot>;
}

/**
 * Normalizes and validates one row. No database access, no matching — this is
 * the part of per-row work that was never the bottleneck and is unchanged.
 */
export function prepareRow(
  row: { rowNumber: number; data: Record<string, string> },
  fieldMappings: FieldMapping,
  parseWarnings: ParseWarning[],
): PreparedRow {
  const { product: normalized, provenance } = normalizeRow(row.data, fieldMappings);
  const qualityStatus = computeDataQualityStatus(normalized);
  const hasParseWarning = parseWarnings.length > 0;

  // Lightweight identifier validation (KI-2). Never fails the row — an invalid
  // GTIN still imports, but is surfaced and marked for review instead of being
  // accepted silently.
  const validationIssues = validateGtin(normalized.gtin, fieldMappings.gtin);

  const effectiveStatus = hasParseWarning
    ? "parse_warning"
    : validationIssues.length > 0
      ? "needs_review"
      : qualityStatus;

  return {
    rowNumber: row.rowNumber,
    raw: row.data,
    normalized,
    provenance,
    hasParseWarning,
    parseErrors: parseWarnings,
    validationIssues,
    effectiveStatus,
  };
}

/** Groups parse warnings once instead of scanning the whole list per row. */
export function indexParseWarnings(warnings: ParseWarning[]): Map<number, ParseWarning[]> {
  const byRow = new Map<number, ParseWarning[]>();
  for (const w of warnings) {
    if (w.rowNumber === undefined) continue;
    const list = byRow.get(w.rowNumber);
    if (list) list.push(w);
    else byRow.set(w.rowNumber, [w]);
  }
  return byRow;
}

/** Identifiers the matcher needs, taken from an already-normalized row. */
export function matchRowFromPrepared(row: PreparedRow) {
  return { rowNumber: row.rowNumber, sku: row.normalized.sku, gtin: row.normalized.gtin };
}

/** The eight canonical fields that carry history, keyed as history records them. */
function historyFieldsOf(p: {
  sku: string | null; gtin: string | null; brand: string | null; productName: string | null;
  shortDescription: string | null; longDescription: string | null;
  category: string | null; manufacturer: string | null;
}): Record<string, unknown> {
  return {
    sku: p.sku,
    gtin: p.gtin,
    brand: p.brand,
    product_name: p.productName,
    short_description: p.shortDescription,
    long_description: p.longDescription,
    category: p.category,
    manufacturer: p.manufacturer,
  };
}

function shallowEqualJson(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
  }
  return true;
}

/**
 * Turns a chunk of prepared rows into the exact set of writes to perform.
 *
 * Rows are walked in file order, because order is semantically load-bearing:
 * within a chunk a later row updating the same product must diff against what
 * the earlier row left, exactly as it did when each row was its own
 * transaction.
 *
 * A product touched by several rows accumulates into ONE update statement. The
 * final column values are identical to applying the updates one at a time — a
 * later row overwrites an earlier one either way — and the history rows are
 * still produced per row, so the audit trail is unchanged.
 */
export function buildChunkPlan(input: ChunkPlanInput): ChunkPlan {
  const { importBatchId, organizationId, catalogId, actor } = input;

  const resolvedByRow = new Map<number, ResolvedRow>();
  for (const r of input.resolved) resolvedByRow.set(r.rowNumber, r);

  const plan: ChunkPlan = {
    creates: [], updates: [], sourceRecords: [], provenance: [], history: [],
    lastRowNumber: 0, createdProducts: 0, updatedProducts: 0,
    unchangedProducts: 0, vanishedRows: 0,
  };

  /** Live state per product, so rows in the chunk see each other's writes. */
  const state = new Map<string, ExistingProductSnapshot>();
  /** Accumulated update payload per product id, in first-touch order. */
  const pendingUpdates = new Map<string, Record<string, unknown>>();
  /** Product id assigned to each pending create, keyed by createIndex. */
  const createdIds = new Map<number, string>();

  for (const row of input.rows) {
    plan.lastRowNumber = Math.max(plan.lastRowNumber, row.rowNumber);

    const resolved = resolvedByRow.get(row.rowNumber);
    if (!resolved) continue;

    // Assigned up front so provenance and history can reference the row's
    // source record without a round trip to read back a generated id.
    const sourceRecordId = randomUUID();
    const key = targetKey(resolved.target);
    const isCreatingRow = resolved.target.kind === "new" && resolved.first;

    let productId: string;

    if (isCreatingRow) {
      productId = randomUUID();
      createdIds.set((resolved.target as { createIndex: number }).createIndex, productId);

      // A row with no identifier at all cannot be matched later either, so it
      // is held for review regardless of how complete the rest of it is.
      const matchStatus = (row.normalized.sku === null && row.normalized.gtin === null)
        ? "needs_review"
        : row.effectiveStatus;
      const dataQualityStatus = row.validationIssues.length > 0 ? "needs_review" : matchStatus;

      plan.creates.push({
        id: productId,
        organizationId,
        catalogId,
        sku: row.normalized.sku,
        gtin: row.normalized.gtin,
        brand: row.normalized.brand,
        productName: row.normalized.productName,
        shortDescription: row.normalized.shortDescription,
        longDescription: row.normalized.longDescription,
        category: row.normalized.category,
        manufacturer: row.normalized.manufacturer,
        lifecycleStatus: "draft",
        dataQualityStatus,
        attributes: (row.normalized.attributes ?? {}) as Prisma.InputJsonValue,
        createdBy: actor,
        updatedBy: actor,
      });

      state.set(key, {
        id: productId,
        sku: row.normalized.sku,
        gtin: row.normalized.gtin,
        brand: row.normalized.brand,
        productName: row.normalized.productName,
        shortDescription: row.normalized.shortDescription,
        longDescription: row.normalized.longDescription,
        category: row.normalized.category,
        manufacturer: row.normalized.manufacturer,
        attributes: { ...(row.normalized.attributes ?? {}) },
        dataQualityStatus,
        updatedBy: actor,
      });

      plan.createdProducts++;
    } else {
      // An update: either an existing catalog product, or one created by an
      // earlier row of this same chunk.
      let current = state.get(key);
      if (!current) {
        if (resolved.target.kind === "existing") {
          const snapshot = input.existing.get(resolved.target.productId);
          if (!snapshot) {
            // The product disappeared between resolving and reading it. There
            // is no delete path today, so this is defensive: the row writes
            // nothing rather than resurrecting a deleted product.
            plan.vanishedRows++;
            continue;
          }
          current = { ...snapshot, attributes: { ...snapshot.attributes } };
        } else {
          // A pending create must already be in `state` — the matcher
          // guarantees the creating row comes first.
          plan.vanishedRows++;
          continue;
        }
        state.set(key, current);
      }

      productId = current.id;

      const updateData: Record<string, unknown> = {};
      const incomingFields: Record<string, unknown> = {};
      const n = row.normalized;

      if (n.sku) { updateData.sku = n.sku; incomingFields.sku = n.sku; }
      if (n.gtin) { updateData.gtin = n.gtin; incomingFields.gtin = n.gtin; }
      if (n.brand) { updateData.brand = n.brand; incomingFields.brand = n.brand; }
      if (n.productName) { updateData.productName = n.productName; incomingFields.product_name = n.productName; }
      if (n.shortDescription) { updateData.shortDescription = n.shortDescription; incomingFields.short_description = n.shortDescription; }
      if (n.longDescription) { updateData.longDescription = n.longDescription; incomingFields.long_description = n.longDescription; }
      if (n.category) { updateData.category = n.category; incomingFields.category = n.category; }
      if (n.manufacturer) { updateData.manufacturer = n.manufacturer; incomingFields.manufacturer = n.manufacturer; }

      let mergedAttributes: Record<string, unknown> | null = null;
      if (Object.keys(n.attributes).length > 0) {
        mergedAttributes = { ...current.attributes, ...n.attributes };
      }

      const historyChanges = diffProductFields(historyFieldsOf(current), incomingFields);

      const attributesChange = mergedAttributes !== null
        && !shallowEqualJson(current.attributes, mergedAttributes);
      const statusChange = current.dataQualityStatus !== row.effectiveStatus;
      const actorChange = current.updatedBy !== actor;

      if (historyChanges.length === 0 && !attributesChange && !statusChange && !actorChange) {
        // UNCHANGED. Every column this row would write already holds the value
        // it would write, so the statement is skipped. The row still gets its
        // source record and provenance — the import is still evidence that the
        // row was seen.
        plan.unchangedProducts++;
      } else {
        if (mergedAttributes !== null) updateData.attributes = mergedAttributes;
        updateData.dataQualityStatus = row.effectiveStatus;
        updateData.updatedBy = actor;

        const accumulated = pendingUpdates.get(productId);
        if (accumulated) Object.assign(accumulated, updateData);
        else pendingUpdates.set(productId, { ...updateData });
      }

      // Apply the row to the live state so the next row diffs against it.
      if (n.sku) current.sku = n.sku;
      if (n.gtin) current.gtin = n.gtin;
      if (n.brand) current.brand = n.brand;
      if (n.productName) current.productName = n.productName;
      if (n.shortDescription) current.shortDescription = n.shortDescription;
      if (n.longDescription) current.longDescription = n.longDescription;
      if (n.category) current.category = n.category;
      if (n.manufacturer) current.manufacturer = n.manufacturer;
      if (mergedAttributes !== null) current.attributes = mergedAttributes;
      current.dataQualityStatus = row.effectiveStatus;
      current.updatedBy = actor;

      for (const change of historyChanges) {
        plan.history.push({
          canonicalProductId: productId,
          field: change.field,
          previousValue: change.previousValue,
          newValue: change.newValue,
          sourceRecordId,
          actor: "system:import",
        });
      }

      plan.updatedProducts++;
    }

    plan.sourceRecords.push({
      id: sourceRecordId,
      importBatchId,
      rowNumber: row.rowNumber,
      sourceRecordKey: row.normalized.sku ?? row.normalized.gtin ?? null,
      rawPayloadJson: row.raw as unknown as Prisma.InputJsonValue,
      parseStatus: row.hasParseWarning ? "warning" : "success",
      parseErrorsJson: row.hasParseWarning
        ? (row.parseErrors as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      canonicalProductId: productId,
    });

    for (const p of row.provenance) {
      plan.provenance.push({
        canonicalProductId: productId,
        canonicalField: p.canonicalField,
        sourceRecordId,
        sourceField: p.sourceField,
        originalValue: p.originalValue,
        normalizedValue: p.normalizedValue,
        normalizationMethod: p.normalizationMethod,
      });
    }
  }

  for (const [id, data] of pendingUpdates) {
    plan.updates.push({ id, data: data as Prisma.CanonicalProductUpdateInput });
  }

  return plan;
}

/**
 * PostgreSQL accepts at most 65,535 bind parameters per statement. A chunk of
 * 100 rows stays far below that, but the chunk size is operator-configurable
 * and provenance can reach eight rows per source row, so bulk inserts are split
 * rather than trusted to be small.
 */
export const MAX_ROWS_PER_INSERT = 500;

export function sliceForInsert<T>(rows: T[]): T[][] {
  if (rows.length <= MAX_ROWS_PER_INSERT) return rows.length ? [rows] : [];
  const slices: T[][] = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_INSERT) {
    slices.push(rows.slice(i, i + MAX_ROWS_PER_INSERT));
  }
  return slices;
}
