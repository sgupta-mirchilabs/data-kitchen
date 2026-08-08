import { describe, it, expect } from "vitest";
import {
  buildChunkPlan,
  indexParseWarnings,
  matchRowFromPrepared,
  prepareRow,
  sliceForInsert,
  MAX_ROWS_PER_INSERT,
  type ExistingProductSnapshot,
  type PreparedRow,
} from "../../src/services/import-chunk.js";
import { resolveMatchesAgainst, type MatchCandidate } from "../../src/services/import-matching.js";
import type { FieldMapping } from "../../src/services/normalizer.js";
import type { ParseWarning } from "../../src/services/parser/parser.types.js";

/**
 * Chunk planning semantics (Phase 1.0.2, Increment B).
 *
 * Everything the old per-row transaction decided is decided here instead, so
 * these tests are the guard on that translation: what gets created, what gets
 * updated, what history is written, and — new in Increment B — what produces no
 * write at all.
 */

const ORG = "org-1";
const CATALOG = "cat-1";
const BATCH = "batch-1";
const ACTOR = "operator@example.com";

const MAPPINGS: FieldMapping = {
  sku: "sku", gtin: "gtin", product_name: "title", brand: "brand", category: "category",
};

function prepared(
  rowNumber: number,
  data: Record<string, string>,
  warnings: ParseWarning[] = [],
): PreparedRow {
  return prepareRow({ rowNumber, data }, MAPPINGS, warnings);
}

/**
 * Rows here carry no GTIN, which is the common shape of a real supplier export
 * and the shape the throughput benchmark uses. A mapped-but-empty GTIN raises
 * GTIN_MISSING, so such a row lands on `needs_review` — that is existing
 * behaviour (KI-2), not something chunking introduced, and the fixtures below
 * are written to agree with it.
 */
function row(rowNumber: number, sku: string, extra: Record<string, string> = {}): PreparedRow {
  return prepared(rowNumber, { sku, gtin: "", title: `Item ${rowNumber}`, brand: "Acme", category: "Tools", ...extra });
}

/** A GTIN-14 with a correct GS1 check digit, so validation raises no issue. */
function validGtin(seed: number): string {
  const payload = String(seed).padStart(13, "0");
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[i]) * weight;
  }
  return payload + String((10 - (sum % 10)) % 10);
}

function snapshot(over: Partial<ExistingProductSnapshot> & { id: string }): ExistingProductSnapshot {
  return {
    sku: null, gtin: null, brand: null, productName: null,
    shortDescription: null, longDescription: null, category: null, manufacturer: null,
    attributes: {}, dataQualityStatus: "needs_review", updatedBy: ACTOR,
    ...over,
  };
}

function plan(rows: PreparedRow[], catalog: MatchCandidate[] = [], existing: ExistingProductSnapshot[] = []) {
  const resolved = resolveMatchesAgainst(catalog, rows.map(matchRowFromPrepared));
  return buildChunkPlan({
    importBatchId: BATCH,
    organizationId: ORG,
    catalogId: CATALOG,
    actor: ACTOR,
    rows,
    resolved,
    existing: new Map(existing.map((e) => [e.id, e])),
  });
}

describe("creates", () => {
  it("emits one bulk create per new product with the tenant carried through", () => {
    const p = plan([row(1, "A"), row(2, "B")]);
    expect(p.creates).toHaveLength(2);
    expect(p.updates).toHaveLength(0);
    expect(p.createdProducts).toBe(2);
    expect(p.creates[0]).toMatchObject({
      organizationId: ORG, catalogId: CATALOG, sku: "A",
      productName: "Item 1", brand: "Acme", category: "Tools",
      lifecycleStatus: "draft", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });

  it("holds a row with no identifier for review however complete the rest is", () => {
    const p = plan([prepared(1, { sku: "", gtin: "", title: "Nameless", brand: "Acme", category: "Tools" })]);
    expect(p.creates[0].dataQualityStatus).toBe("needs_review");
  });

  it("marks a row missing core fields rather than calling it complete", () => {
    const p = plan([prepared(1, { sku: "A", gtin: validGtin(1), title: "", brand: "", category: "" })]);
    expect(p.creates[0].dataQualityStatus).toBe("missing_core_fields");
  });

  it("marks a row with an invalid GTIN for review", () => {
    const p = plan([prepared(1, { sku: "A", gtin: "12345678901234", title: "T", brand: "B", category: "C" })]);
    expect(p.creates[0].dataQualityStatus).toBe("needs_review");
  });

  it("records a parse warning on the source record and the product status", () => {
    const warning: ParseWarning = { rowNumber: 1, message: "column count mismatch", type: "column_count_mismatch" };
    const p = plan([prepared(1, { sku: "A", gtin: validGtin(1), title: "T", brand: "B", category: "C" }, [warning])]);
    expect(p.creates[0].dataQualityStatus).toBe("parse_warning");
    expect(p.sourceRecords[0].parseStatus).toBe("warning");
    expect(p.sourceRecords[0].parseErrorsJson).toEqual([warning]);
  });

  it("keeps unmapped columns as attributes", () => {
    const p = plan([row(1, "A", { colour: "red" })]);
    expect(p.creates[0].attributes).toEqual({ colour: "red" });
  });
});

describe("updates", () => {
  const existingA = snapshot({ id: "p1", sku: "A", productName: "Old name", brand: "Acme", category: "Tools" });

  it("writes only the product whose values actually change", () => {
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Old name" }], [existingA]);
    expect(p.creates).toHaveLength(0);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].id).toBe("p1");
    expect(p.updates[0].data).toMatchObject({ productName: "Item 1", updatedBy: ACTOR });
    expect(p.updatedProducts).toBe(1);
    expect(p.unchangedProducts).toBe(0);
  });

  it("writes history only for the fields that changed", () => {
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Old name" }], [existingA]);
    expect(p.history.map((h) => h.field)).toEqual(["product_name"]);
    expect(p.history[0]).toMatchObject({
      canonicalProductId: "p1", previousValue: "Old name", newValue: "Item 1", actor: "system:import",
    });
  });

  it("never writes history for an unchanged field", () => {
    // sku, brand and category are identical; only the name moves.
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Old name" }], [existingA]);
    expect(p.history.map((h) => h.field)).not.toContain("sku");
    expect(p.history.map((h) => h.field)).not.toContain("brand");
    expect(p.history.map((h) => h.field)).not.toContain("category");
  });

  it("merges attributes rather than replacing them", () => {
    const withAttrs = snapshot({
      id: "p1", sku: "A", productName: "Item 1", brand: "Acme", category: "Tools",
      attributes: { colour: "red", weight: "2kg" },
    });
    const p = plan(
      [row(1, "A", { colour: "blue" })],
      [{ id: "p1", sku: "A", gtin: null, productName: "Item 1" }],
      [withAttrs],
    );
    expect(p.updates[0].data.attributes).toEqual({ colour: "blue", weight: "2kg" });
  });
});

describe("unchanged rows produce no canonical write", () => {
  const identical = snapshot({
    id: "p1", sku: "A", productName: "Item 1", brand: "Acme", category: "Tools",
    dataQualityStatus: "needs_review", updatedBy: ACTOR,
  });

  it("re-importing an identical row writes no product statement and no history", () => {
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Item 1" }], [identical]);
    expect(p.updates).toHaveLength(0);
    expect(p.history).toHaveLength(0);
    expect(p.unchangedProducts).toBe(1);
    // The row was still seen: the import remains evidence of it.
    expect(p.sourceRecords).toHaveLength(1);
    expect(p.provenance.length).toBeGreaterThan(0);
  });

  it("still writes when only the data-quality status differs", () => {
    const stale = snapshot({ ...identical, dataQualityStatus: "complete" });
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Item 1" }], [stale]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].data).toMatchObject({ dataQualityStatus: "needs_review" });
    // A status correction is not a field change, so it leaves no history.
    expect(p.history).toHaveLength(0);
  });

  it("still writes when a different operator last touched the product", () => {
    const other = snapshot({ ...identical, updatedBy: "someone-else" });
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "Item 1" }], [other]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].data).toMatchObject({ updatedBy: ACTOR });
  });

  it("does not write when incoming attributes add nothing new", () => {
    const withAttrs = snapshot({ ...identical, attributes: { colour: "red" } });
    const p = plan(
      [row(1, "A", { colour: "red" })],
      [{ id: "p1", sku: "A", gtin: null, productName: "Item 1" }],
      [withAttrs],
    );
    expect(p.updates).toHaveLength(0);
    expect(p.unchangedProducts).toBe(1);
  });
});

describe("several rows touching one product", () => {
  it("collapses to one update whose values match applying them in order", () => {
    const p = plan(
      [row(1, "A", { title: "First" }), row(2, "A", { title: "Second" })],
      [],
    );
    // Row 1 creates, row 2 updates the product row 1 created.
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0].productName).toBe("First");
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].id).toBe(p.creates[0].id);
    expect(p.updates[0].data).toMatchObject({ productName: "Second" });
  });

  it("diffs each row against what the previous row left, not against the snapshot", () => {
    const start = snapshot({ id: "p1", sku: "A", productName: "Original", brand: "Acme", category: "Tools" });
    const p = plan(
      [row(1, "A", { title: "Middle" }), row(2, "A", { title: "Final" })],
      [{ id: "p1", sku: "A", gtin: null, productName: "Original" }],
      [start],
    );
    // Two history entries forming a continuous chain — not two entries both
    // claiming they changed the name away from "Original".
    expect(p.history).toHaveLength(2);
    expect(p.history[0]).toMatchObject({ previousValue: "Original", newValue: "Middle" });
    expect(p.history[1]).toMatchObject({ previousValue: "Middle", newValue: "Final" });
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].data).toMatchObject({ productName: "Final" });
  });

  it("counts a repeat of an identical row as unchanged", () => {
    // Row 2 repeats row 1 verbatim: it creates nothing and writes nothing.
    const p = plan([row(1, "A"), row(2, "A", { title: "Item 1" })]);
    expect(p.createdProducts).toBe(1);
    expect(p.unchangedProducts).toBe(1);
    expect(p.updates).toHaveLength(0);
  });
});

describe("source records, provenance and history linkage", () => {
  it("keeps row-number identity for every row", () => {
    const p = plan([row(7, "A"), row(8, "B"), row(9, "C")]);
    expect(p.sourceRecords.map((s) => s.rowNumber)).toEqual([7, 8, 9]);
    expect(p.lastRowNumber).toBe(9);
  });

  it("gives every source record a distinct id within the chunk", () => {
    const p = plan([row(1, "A"), row(2, "B")]);
    expect(new Set(p.sourceRecords.map((s) => s.id)).size).toBe(2);
  });

  it("points provenance at the source record of its own row", () => {
    const p = plan([row(1, "A"), row(2, "B")]);
    const firstId = p.sourceRecords[0].id;
    const secondId = p.sourceRecords[1].id;
    const firstProduct = p.creates[0].id;
    for (const entry of p.provenance.filter((x) => x.canonicalProductId === firstProduct)) {
      expect(entry.sourceRecordId).toBe(firstId);
    }
    expect(p.provenance.some((x) => x.sourceRecordId === secondId)).toBe(true);
  });

  it("points history at the source record of the row that caused it", () => {
    const start = snapshot({ id: "p1", sku: "A", productName: "Original", brand: "Acme", category: "Tools" });
    const p = plan(
      [row(1, "A", { title: "Middle" }), row(2, "A", { title: "Final" })],
      [{ id: "p1", sku: "A", gtin: null, productName: "Original" }],
      [start],
    );
    expect(p.history[0].sourceRecordId).toBe(p.sourceRecords[0].id);
    expect(p.history[1].sourceRecordId).toBe(p.sourceRecords[1].id);
  });

  it("records the business key on the source record, preferring SKU", () => {
    const p = plan([
      row(1, "A"),
      prepared(2, { sku: "", gtin: "00012345678905", title: "T", brand: "B", category: "C" }),
    ]);
    expect(p.sourceRecords[0].sourceRecordKey).toBe("A");
    expect(p.sourceRecords[1].sourceRecordKey).toBe("00012345678905");
  });

  it("writes provenance for every mapped field the row carried", () => {
    const p = plan([row(1, "A")]);
    const fields = p.provenance.map((x) => x.canonicalField).sort();
    expect(fields).toEqual(["brand", "category", "product_name", "sku"]);
  });
});

describe("a matched product that vanished", () => {
  it("writes nothing for the row rather than resurrecting the product", () => {
    // The snapshot map is deliberately empty: the match resolved to p1 but the
    // read did not return it.
    const p = plan([row(1, "A")], [{ id: "p1", sku: "A", gtin: null, productName: "x" }], []);
    expect(p.vanishedRows).toBe(1);
    expect(p.creates).toHaveLength(0);
    expect(p.updates).toHaveLength(0);
    expect(p.sourceRecords).toHaveLength(0);
    expect(p.updatedProducts).toBe(0);
  });
});

describe("parse warning indexing", () => {
  it("groups warnings by row and drops file-level ones", () => {
    const byRow = indexParseWarnings([
      { rowNumber: 2, message: "a", type: "empty_row" },
      { rowNumber: 2, message: "b", type: "empty_row" },
      { message: "file level", type: "duplicate_header" },
    ]);
    expect(byRow.get(2)).toHaveLength(2);
    expect(byRow.size).toBe(1);
  });
});

describe("bulk insert slicing", () => {
  it("returns nothing for an empty list", () => {
    expect(sliceForInsert([])).toEqual([]);
  });

  it("keeps a normal chunk as a single statement", () => {
    expect(sliceForInsert(Array.from({ length: 100 }, (_, i) => i))).toHaveLength(1);
  });

  it("splits past the parameter-safe limit rather than failing at the driver", () => {
    const slices = sliceForInsert(Array.from({ length: MAX_ROWS_PER_INSERT * 2 + 1 }, (_, i) => i));
    expect(slices).toHaveLength(3);
    expect(slices.flat()).toHaveLength(MAX_ROWS_PER_INSERT * 2 + 1);
  });
});
