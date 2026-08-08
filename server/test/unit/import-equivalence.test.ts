import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { normalizeRow, type FieldMapping } from "../../src/services/normalizer.js";
import {
  matchRowFromRaw,
  resolveMatchesAgainst,
  targetKey,
  type MatchCandidate,
  type MatchRow,
} from "../../src/services/import-matching.js";
import { projectImportImpact } from "../../src/services/import-projection.js";

/**
 * Preview/commit equivalence (Phase 1.0.2, Increment B, step 1).
 *
 * The preview promises the operator "this many creates, this many updates, and
 * here are the products you are about to overwrite". The commit is what
 * actually happens. Nothing in the type system forces those two to agree — this
 * suite does.
 *
 * Both paths reach the matcher by different routes: the preview from raw file
 * text plus a header name, the commit from a normalized product. The test
 * drives both routes over the same fixtures and asserts they classify every row
 * identically. It fails if either route is changed alone.
 */

const CATALOG = "cat-sandbox";
const ORG = "org-1";

const MAPPINGS: FieldMapping = {
  sku: "sku", gtin: "gtin", product_name: "title", brand: "brand",
};

interface Fixture {
  name: string;
  rows: Array<{ rowNumber: number; data: Record<string, string> }>;
  catalog: MatchCandidate[];
}

const product = (id: string, sku: string | null, gtin: string | null = null): MatchCandidate =>
  ({ id, sku, gtin, productName: `Product ${id}` });

const row = (rowNumber: number, sku: string, gtin = "", title = `Item ${rowNumber}`) =>
  ({ rowNumber, data: { sku, gtin, title, brand: "Acme" } });

const FIXTURES: Fixture[] = [
  {
    name: "first-time import, nothing in the catalog",
    rows: [row(1, "A"), row(2, "B"), row(3, "C")],
    catalog: [],
  },
  {
    name: "re-upload of a file already imported",
    rows: [row(1, "A"), row(2, "B"), row(3, "C")],
    catalog: [product("p1", "A"), product("p2", "B"), product("p3", "C")],
  },
  {
    name: "mixed creates and updates",
    rows: [row(1, "A"), row(2, "NEW-1"), row(3, "B"), row(4, "NEW-2")],
    catalog: [product("p1", "A"), product("p2", "B")],
  },
  {
    name: "in-file duplicate SKU",
    rows: [row(1, "A"), row(2, "B"), row(3, "A")],
    catalog: [],
  },
  {
    name: "in-file duplicate against an existing product",
    rows: [row(1, "A"), row(2, "A")],
    catalog: [product("p1", "A")],
  },
  {
    name: "GTIN fallback when the SKU is new",
    rows: [row(1, "NEW-SKU", "00012345678905")],
    catalog: [product("p1", "OLD-SKU", "00012345678905")],
  },
  {
    name: "short GTIN in the file, GTIN-14 in the catalog",
    // The row a raw-text comparison used to get wrong: previewed as a create,
    // committed as an update.
    rows: [row(1, "", "012345678905")],
    catalog: [product("p1", null, "00012345678905")],
  },
  {
    name: "GTIN written with separators",
    rows: [row(1, "", "0-12345-67890-5")],
    catalog: [product("p1", null, "00012345678905")],
  },
  {
    name: "SKU wins over a GTIN pointing elsewhere",
    rows: [row(1, "A", "00012345678905")],
    catalog: [product("by-sku", "A", "999"), product("by-gtin", "Z", "00012345678905")],
  },
  {
    name: "whitespace around identifiers",
    rows: [row(1, "  A  "), row(2, "A")],
    catalog: [product("p1", "A")],
  },
  {
    name: "GTIN-only rows landing on a product created earlier in the same file",
    rows: [row(1, "A", "00012345678905"), row(2, "", "00012345678905")],
    catalog: [],
  },
  {
    name: "row with neither identifier",
    rows: [row(1, ""), row(2, "A")],
    catalog: [product("p1", "A")],
  },
  {
    name: "catalog contains a product that no row mentions",
    rows: [row(1, "A")],
    catalog: [product("p1", "A"), product("p2", "UNRELATED")],
  },
];

/** How the preview reduces a file row to match identifiers. */
function previewMatchRow(r: Fixture["rows"][number]): MatchRow {
  return matchRowFromRaw(r, MAPPINGS.sku, MAPPINGS.gtin);
}

/** How the commit pipeline reduces the same row: normalize, then match. */
function commitMatchRow(r: Fixture["rows"][number]): MatchRow {
  const { product: normalized } = normalizeRow(r.data, MAPPINGS);
  return { rowNumber: r.rowNumber, sku: normalized.sku, gtin: normalized.gtin };
}

describe("preview and commit derive identical match identifiers", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      for (const r of fixture.rows) {
        expect(previewMatchRow(r)).toEqual(commitMatchRow(r));
      }
    });
  }
});

describe("preview and commit classify every row identically", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const preview = resolveMatchesAgainst(fixture.catalog, fixture.rows.map(previewMatchRow));
      const commit = resolveMatchesAgainst(fixture.catalog, fixture.rows.map(commitMatchRow));

      const shape = (rows: typeof preview) =>
        rows.map((x) => ({
          rowNumber: x.rowNumber,
          target: targetKey(x.target),
          action: x.target.kind === "existing" ? "update" : x.first ? "create" : "update",
          matchedOn: x.matchedOn,
        }));

      expect(shape(preview)).toEqual(shape(commit));
    });
  }
});

describe("the projection's counts equal the commit's outcome", () => {
  function fakePrisma(catalog: MatchCandidate[]) {
    return {
      canonicalProduct: {
        findMany: async ({ where }: { where: { OR?: Array<Record<string, { in: string[] }>> } }) => {
          const skus = where.OR?.find((o) => o.sku)?.sku?.in ?? [];
          const gtins = where.OR?.find((o) => o.gtin)?.gtin?.in ?? [];
          return catalog.filter(
            (c) => (c.sku && skus.includes(c.sku)) || (c.gtin && gtins.includes(c.gtin)),
          );
        },
      },
    } as unknown as PrismaClient;
  }

  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const projection = await projectImportImpact(
        fakePrisma(fixture.catalog), CATALOG, fixture.rows, MAPPINGS.sku, MAPPINGS.gtin, ORG,
      );

      // What the commit will do, counted the same way: rows carrying an
      // identifier, collapsed to distinct products.
      const commitRows = resolveMatchesAgainst(
        fixture.catalog,
        fixture.rows.map(commitMatchRow).filter((m) => m.sku !== null || m.gtin !== null),
      );
      const seen = new Set<string>();
      let creates = 0;
      let updates = 0;
      const overwritten: string[] = [];
      for (const r of commitRows) {
        const key = targetKey(r.target);
        if (seen.has(key)) continue;
        seen.add(key);
        if (r.target.kind === "existing") {
          updates++;
          overwritten.push(r.target.productId);
        } else {
          creates++;
        }
      }

      expect(projection.willCreate).toBe(creates);
      expect(projection.willUpdate).toBe(updates);
      expect(projection.distinctProducts).toBe(seen.size);
      expect(projection.existingMatches.map((m) => m.productId)).toEqual(overwritten);
    });
  }
});
