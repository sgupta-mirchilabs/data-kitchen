import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { projectImportImpact } from "../../src/services/import-projection.js";

const CATALOG = "cat-sandbox";

interface Existing { id: string; catalogId: string; sku: string | null; gtin: string | null; productName: string | null }

function fakePrisma(existing: Existing[]) {
  let queries = 0;
  const prisma = {
    canonicalProduct: {
      findMany: async ({ where }: { where: { catalogId: string; OR?: Array<Record<string, { in: string[] }>> } }) => {
        queries++;
        const skus = where.OR?.find((o) => o.sku)?.sku?.in ?? [];
        const gtins = where.OR?.find((o) => o.gtin)?.gtin?.in ?? [];
        return existing.filter(
          (e) => e.catalogId === where.catalogId &&
            ((e.sku && skus.includes(e.sku)) || (e.gtin && gtins.includes(e.gtin))),
        );
      },
    },
  } as unknown as PrismaClient;
  return { prisma, queryCount: () => queries };
}

const row = (rowNumber: number, sku: string, gtin = "") => ({ rowNumber, data: { sku, gtin } });

describe("projectImportImpact", () => {
  it("reports the real impact of re-uploading a file already imported", () => {
    // The operator-reported case: every row matches an existing product, but
    // the in-file duplicate warning alone said "1 row will be superseded".
    const existing: Existing[] = [
      { id: "p1", catalogId: CATALOG, sku: "NF-APEX-M-BLK", gtin: null, productName: "Jacket" },
      { id: "p2", catalogId: CATALOG, sku: "SG-HDPH-WHT", gtin: null, productName: "Headphones" },
      { id: "p3", catalogId: CATALOG, sku: "GD-FERT-5LB", gtin: null, productName: "Fertilizer" },
      { id: "p4", catalogId: CATALOG, sku: "PT-PAINT-NVY-1GAL", gtin: null, productName: "Paint" },
    ];
    const rows = [
      row(1, "NF-APEX-M-BLK"), row(2, "SG-HDPH-WHT"), row(3, "GD-FERT-5LB"),
      row(4, "PT-PAINT-NVY-1GAL"), row(5, "SG-HDPH-WHT"),
    ];
    const { prisma } = fakePrisma(existing);
    return projectImportImpact(prisma, CATALOG, rows, "sku", "gtin").then((p) => {
      expect(p.totalRows).toBe(5);
      // The repeated SKU collapses to one product.
      expect(p.distinctProducts).toBe(4);
      expect(p.willUpdate).toBe(4);
      expect(p.willCreate).toBe(0);
      expect(p.existingMatches.map((m) => m.key).sort()).toEqual(
        ["GD-FERT-5LB", "NF-APEX-M-BLK", "PT-PAINT-NVY-1GAL", "SG-HDPH-WHT"],
      );
    });
  });

  it("reports all creates for a first-time import", async () => {
    const { prisma } = fakePrisma([]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A"), row(2, "B")], "sku", "gtin");
    expect(p).toMatchObject({ willCreate: 2, willUpdate: 0, distinctProducts: 2 });
    expect(p.existingMatches).toEqual([]);
  });

  it("handles a mixed file", async () => {
    const { prisma } = fakePrisma([
      { id: "p1", catalogId: CATALOG, sku: "A", gtin: null, productName: "Existing A" },
    ]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A"), row(2, "B")], "sku", "gtin");
    expect(p).toMatchObject({ willCreate: 1, willUpdate: 1 });
    expect(p.existingMatches[0]).toMatchObject({ key: "A", matchedOn: "sku", productName: "Existing A" });
  });

  it("does not count products from a different catalog", async () => {
    const { prisma } = fakePrisma([
      { id: "other", catalogId: "cat-q3", sku: "A", gtin: null, productName: "Q3 copy" },
    ]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A")], "sku", "gtin");
    expect(p).toMatchObject({ willCreate: 1, willUpdate: 0 });
  });

  it("matches on GTIN when the SKU does not match", async () => {
    const { prisma } = fakePrisma([
      { id: "p1", catalogId: CATALOG, sku: "OLD-SKU", gtin: "00012345678905", productName: "By GTIN" },
    ]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "NEW-SKU", "00012345678905")], "sku", "gtin");
    expect(p).toMatchObject({ willUpdate: 1, willCreate: 0 });
    expect(p.existingMatches[0].matchedOn).toBe("gtin");
  });

  it("prefers a SKU match over a GTIN match, mirroring findDuplicate", async () => {
    const { prisma } = fakePrisma([
      { id: "by-sku", catalogId: CATALOG, sku: "A", gtin: "999", productName: "By SKU" },
      { id: "by-gtin", catalogId: CATALOG, sku: "Z", gtin: "00012345678905", productName: "By GTIN" },
    ]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A", "00012345678905")], "sku", "gtin");
    expect(p.existingMatches[0]).toMatchObject({ matchedOn: "sku", productId: "by-sku" });
  });

  it("uses a single batched query regardless of row count", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i + 1, `SKU-${i}`));
    const { prisma, queryCount } = fakePrisma([]);
    await projectImportImpact(prisma, CATALOG, rows, "sku", "gtin");
    expect(queryCount()).toBe(1);
  });

  it("ignores rows with no usable identity", async () => {
    const { prisma } = fakePrisma([]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, ""), row(2, "   ")], "sku", "gtin");
    expect(p).toMatchObject({ distinctProducts: 0, willCreate: 0, willUpdate: 0 });
  });

  it("returns an empty projection when neither identifier column is mapped", async () => {
    const { prisma, queryCount } = fakePrisma([]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A")], undefined, undefined);
    expect(p).toMatchObject({ distinctProducts: 0, willUpdate: 0 });
    expect(queryCount()).toBe(0);
  });

  it("trims values so whitespace does not create a phantom product", async () => {
    const { prisma } = fakePrisma([
      { id: "p1", catalogId: CATALOG, sku: "A", gtin: null, productName: "A" },
    ]);
    const p = await projectImportImpact(prisma, CATALOG, [row(1, "A "), row(2, " A")], "sku", "gtin");
    expect(p).toMatchObject({ distinctProducts: 1, willUpdate: 1, willCreate: 0 });
  });
});
