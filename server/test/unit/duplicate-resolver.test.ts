import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { findDuplicate } from "../../src/services/duplicate-resolver.js";

const CAT_SANDBOX = "cat-sandbox";
const CAT_Q3 = "cat-q3";

interface Row {
  id: string;
  catalogId: string;
  sku: string | null;
  gtin: string | null;
}

/**
 * Prisma stand-in backed by a fixed row set. It honours only the fields
 * findDuplicate actually filters on, so a query that forgot to constrain by
 * catalogId would match rows in other catalogs and fail the assertions below.
 */
function fakePrisma(rows: Row[]) {
  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    canonicalProduct: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push(where);
        const found = rows.find((r) =>
          Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
        );
        return found ? { id: found.id } : null;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

const ROWS: Row[] = [
  { id: "prod-sandbox", catalogId: CAT_SANDBOX, sku: "MRC-1001", gtin: "00012345678905" },
];

describe("findDuplicate — catalog scoping", () => {
  it("matches by SKU within the same catalog", async () => {
    const { prisma } = fakePrisma(ROWS);
    const hit = await findDuplicate(prisma, CAT_SANDBOX, "MRC-1001", null);
    expect(hit).toEqual({ existingProductId: "prod-sandbox", matchedOn: "sku" });
  });

  it("matches by GTIN within the same catalog", async () => {
    const { prisma } = fakePrisma(ROWS);
    const hit = await findDuplicate(prisma, CAT_SANDBOX, null, "00012345678905");
    expect(hit).toEqual({ existingProductId: "prod-sandbox", matchedOn: "gtin" });
  });

  it("does NOT match the same SKU in a different catalog", async () => {
    const { prisma } = fakePrisma(ROWS);
    // Same organization, different catalog — must be treated as a new product.
    expect(await findDuplicate(prisma, CAT_Q3, "MRC-1001", null)).toBeNull();
  });

  it("does NOT match the same GTIN in a different catalog", async () => {
    const { prisma } = fakePrisma(ROWS);
    expect(await findDuplicate(prisma, CAT_Q3, null, "00012345678905")).toBeNull();
  });

  it("constrains every lookup by catalogId", async () => {
    const { prisma, calls } = fakePrisma(ROWS);
    await findDuplicate(prisma, CAT_Q3, "MRC-1001", "00012345678905");
    expect(calls.length).toBeGreaterThan(0);
    for (const where of calls) {
      expect(where).toHaveProperty("catalogId", CAT_Q3);
    }
  });

  it("returns null when neither identifier is supplied", async () => {
    const { prisma, calls } = fakePrisma(ROWS);
    expect(await findDuplicate(prisma, CAT_SANDBOX, null, null)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("prefers a SKU match over a GTIN match", async () => {
    const rows: Row[] = [
      { id: "by-sku", catalogId: CAT_SANDBOX, sku: "MRC-1001", gtin: "different" },
      { id: "by-gtin", catalogId: CAT_SANDBOX, sku: "other", gtin: "00012345678905" },
    ];
    const { prisma } = fakePrisma(rows);
    const hit = await findDuplicate(prisma, CAT_SANDBOX, "MRC-1001", "00012345678905");
    expect(hit).toEqual({ existingProductId: "by-sku", matchedOn: "sku" });
  });
});
