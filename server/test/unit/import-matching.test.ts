import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  matchRowFromRaw,
  resolveImportMatches,
  resolveMatchesAgainst,
  targetKey,
  type MatchCandidate,
  type MatchRow,
} from "../../src/services/import-matching.js";

/**
 * The matching rule, tested once, in the one place it now lives.
 *
 * These absorb what `duplicate-resolver.test.ts` guarded — catalog scoping,
 * SKU-before-GTIN, no query when a row carries no identifier — and add the
 * in-file behaviour the serial pipeline used to get implicitly from the
 * database, which a batched resolver has to reproduce deliberately.
 */

const CATALOG = "cat-sandbox";

const existing = (id: string, sku: string | null, gtin: string | null = null): MatchCandidate =>
  ({ id, sku, gtin, productName: `Product ${id}` });

const r = (rowNumber: number, sku: string | null, gtin: string | null = null): MatchRow =>
  ({ rowNumber, sku, gtin });

describe("resolveMatchesAgainst — SKU first, GTIN fallback", () => {
  it("matches on SKU", () => {
    const [row] = resolveMatchesAgainst([existing("p1", "A")], [r(1, "A")]);
    expect(row.target).toMatchObject({ kind: "existing", productId: "p1" });
    expect(row.matchedOn).toBe("sku");
    expect(row.matchedValue).toBe("A");
  });

  it("falls back to GTIN only when the SKU does not match", () => {
    const [row] = resolveMatchesAgainst(
      [existing("p1", "OLD-SKU", "00012345678905")],
      [r(1, "NEW-SKU", "00012345678905")],
    );
    expect(row.target).toMatchObject({ kind: "existing", productId: "p1" });
    expect(row.matchedOn).toBe("gtin");
    expect(row.matchedValue).toBe("00012345678905");
  });

  it("prefers the SKU match when SKU and GTIN point at different products", () => {
    const [row] = resolveMatchesAgainst(
      [existing("by-sku", "A", "999"), existing("by-gtin", "Z", "00012345678905")],
      [r(1, "A", "00012345678905")],
    );
    expect(row.target).toMatchObject({ productId: "by-sku" });
    expect(row.matchedOn).toBe("sku");
  });

  it("creates when neither identifier matches", () => {
    const [row] = resolveMatchesAgainst([existing("p1", "A")], [r(1, "B", "00012345678905")]);
    expect(row.target).toEqual({ kind: "new", createIndex: 0 });
    expect(row.matchedOn).toBeNull();
    expect(row.first).toBe(true);
  });

  it("creates for a row carrying neither identifier", () => {
    const rows = resolveMatchesAgainst([existing("p1", "A")], [r(1, null, null), r(2, null, null)]);
    // Two identifier-less rows are two distinct products, never a match.
    expect(rows[0].target).toEqual({ kind: "new", createIndex: 0 });
    expect(rows[1].target).toEqual({ kind: "new", createIndex: 1 });
  });
});

describe("resolveMatchesAgainst — in-file duplicates", () => {
  it("sends a repeated SKU to the product the earlier row creates", () => {
    const rows = resolveMatchesAgainst([], [r(1, "A"), r(2, "B"), r(3, "A")]);
    expect(rows[0].target).toEqual({ kind: "new", createIndex: 0 });
    expect(rows[2].target).toEqual({ kind: "new", createIndex: 0 });
    expect(rows[0].first).toBe(true);
    expect(rows[2].first).toBe(false);
    expect(rows[2].matchedOn).toBe("sku");
    // Three rows, two products.
    expect(new Set(rows.map((x) => targetKey(x.target))).size).toBe(2);
  });

  it("sends a later GTIN-only row to a product created by an earlier row", () => {
    // The serial pipeline behaved this way because row 1's product was already
    // in the database when row 2 was matched.
    const rows = resolveMatchesAgainst([], [r(1, "A", "00012345678905"), r(2, null, "00012345678905")]);
    expect(rows[1].target).toEqual({ kind: "new", createIndex: 0 });
    expect(rows[1].matchedOn).toBe("gtin");
    expect(rows[1].first).toBe(false);
  });

  it("marks only the first row of a repeated existing match as first", () => {
    const rows = resolveMatchesAgainst([existing("p1", "A")], [r(1, "A"), r(2, "A")]);
    expect(rows.map((x) => x.first)).toEqual([true, false]);
    expect(rows.every((x) => x.target.kind === "existing")).toBe(true);
  });

  it("keeps createIndex stable so several rows agree before any id exists", () => {
    const rows = resolveMatchesAgainst([], [r(1, "A"), r(2, "A"), r(3, "A")]);
    expect(rows.map((x) => (x.target as { createIndex: number }).createIndex)).toEqual([0, 0, 0]);
  });
});

describe("resolveMatchesAgainst — determinism with duplicate candidates", () => {
  it("takes the first candidate when two products share a GTIN", () => {
    const rows = resolveMatchesAgainst(
      [existing("first", null, "00012345678905"), existing("second", null, "00012345678905")],
      [r(1, null, "00012345678905")],
    );
    expect(rows[0].target).toMatchObject({ productId: "first" });
  });
});

describe("matchRowFromRaw", () => {
  const raw = (sku: string, gtin = "") => ({ rowNumber: 1, data: { sku, gtin } });

  it("trims the SKU and treats blank as absent", () => {
    expect(matchRowFromRaw(raw("  A  "), "sku", "gtin").sku).toBe("A");
    expect(matchRowFromRaw(raw("   "), "sku", "gtin").sku).toBeNull();
  });

  it("pads a short GTIN to 14 digits, as the commit pipeline stores it", () => {
    // The divergence this closes: the preview used to compare "012345678905"
    // against a stored "00012345678905" and report a create for a row the
    // commit would have treated as an update.
    expect(matchRowFromRaw(raw("", "012345678905"), "sku", "gtin").gtin).toBe("00012345678905");
  });

  it("passes an unparseable GTIN through unchanged", () => {
    expect(matchRowFromRaw(raw("", "abc"), "sku", "gtin").gtin).toBe("abc");
  });

  it("returns null identifiers when the headers are not mapped", () => {
    const m = matchRowFromRaw(raw("A", "00012345678905"), undefined, undefined);
    expect(m).toMatchObject({ sku: null, gtin: null });
  });
});

describe("resolveImportMatches — query shape", () => {
  function fakePrisma(candidates: Array<MatchCandidate & { catalogId: string; organizationId?: string }>) {
    let queries = 0;
    let lastWhere: Record<string, unknown> | null = null;
    const prisma = {
      canonicalProduct: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          queries++;
          lastWhere = where;
          const or = (where.OR ?? []) as Array<Record<string, { in: string[] }>>;
          const skus = or.find((o) => o.sku)?.sku?.in ?? [];
          const gtins = or.find((o) => o.gtin)?.gtin?.in ?? [];
          return candidates.filter(
            (c) => c.catalogId === where.catalogId &&
              (where.organizationId === undefined || c.organizationId === where.organizationId) &&
              ((c.sku && skus.includes(c.sku)) || (c.gtin && gtins.includes(c.gtin))),
          );
        },
      },
    } as unknown as PrismaClient;
    return { prisma, queryCount: () => queries, where: () => lastWhere };
  }

  it("issues exactly one query for 1,000 rows", async () => {
    const { prisma, queryCount } = fakePrisma([]);
    const rows = Array.from({ length: 1000 }, (_, i) => r(i + 1, `SKU-${i}`));
    await resolveImportMatches(prisma, { catalogId: CATALOG }, rows);
    expect(queryCount()).toBe(1);
  });

  it("issues no query when no row carries an identifier", async () => {
    const { prisma, queryCount } = fakePrisma([]);
    const rows = await resolveImportMatches(prisma, { catalogId: CATALOG }, [r(1, null), r(2, null)]);
    expect(queryCount()).toBe(0);
    expect(rows.every((x) => x.target.kind === "new")).toBe(true);
  });

  it("scopes the query to the catalog and the organization", async () => {
    const { prisma, where } = fakePrisma([]);
    await resolveImportMatches(prisma, { catalogId: CATALOG, organizationId: "org-1" }, [r(1, "A")]);
    expect(where()).toMatchObject({ catalogId: CATALOG, organizationId: "org-1" });
  });

  it("does not match a product in another catalog", async () => {
    const { prisma } = fakePrisma([{ ...existing("other", "A"), catalogId: "cat-q3" }]);
    const rows = await resolveImportMatches(prisma, { catalogId: CATALOG }, [r(1, "A")]);
    expect(rows[0].target.kind).toBe("new");
  });

  it("does not match a product in another organization", async () => {
    const { prisma } = fakePrisma([
      { ...existing("other", "A"), catalogId: CATALOG, organizationId: "org-2" },
    ]);
    const rows = await resolveImportMatches(
      prisma, { catalogId: CATALOG, organizationId: "org-1" }, [r(1, "A")],
    );
    expect(rows[0].target.kind).toBe("new");
  });

  it("de-duplicates identifiers before querying", async () => {
    let seenSkus: string[] = [];
    const prisma = {
      canonicalProduct: {
        findMany: async ({ where }: { where: { OR: Array<Record<string, { in: string[] }>> } }) => {
          seenSkus = where.OR.find((o) => o.sku)?.sku?.in ?? [];
          return [];
        },
      },
    } as unknown as PrismaClient;
    await resolveImportMatches(prisma, { catalogId: CATALOG }, [r(1, "A"), r(2, "A"), r(3, "B")]);
    expect(seenSkus.sort()).toEqual(["A", "B"]);
  });
});
