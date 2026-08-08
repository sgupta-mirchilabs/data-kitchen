import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { saveTemplate } from "../../src/services/mapping-template.service.js";

const ORG = "org-1";

/**
 * Prisma stand-in that mimics the one behaviour that caused the bug:
 * PostgreSQL JSONB does not preserve key insertion order. Stored mappings are
 * returned with keys ordered by length, then bytewise — exactly as observed in
 * the live database.
 */
function jsonbOrder(m: Record<string, string>): Record<string, string> {
  const keys = Object.keys(m).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return Object.fromEntries(keys.map((k) => [k, m[k]]));
}

function fakePrisma(seed: Array<{ id: string; version: number; mappings: Record<string, string>; headerFingerprint: string }>) {
  const rows = seed.map((r) => ({ ...r, mappings: jsonbOrder(r.mappings), organizationId: ORG, sourceType: "csv" }));
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const prisma = {
    mappingTemplate: {
      findMany: async ({ where }: { where: { headerFingerprint?: string } }) =>
        rows.filter((r) => !where.headerFingerprint || r.headerFingerprint === where.headerFingerprint)
            .sort((a, b) => b.version - a.version),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updated.push({ id: where.id, ...data });
        const row = rows.find((r) => r.id === where.id)!;
        return { ...row, ...data };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "new-id", version: data.version as number, ...data };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, created, updated };
}

const MAPPINGS = {
  sku: "sku",
  gtin: "gtin",
  brand: "brand",
  category: "category",
  manufacturer: "brand",
  product_name: "title",
  long_description: "description",
};

const HEADERS = ["sku", "gtin", "brand", "title", "category", "description"];

// The fingerprint the service will compute for HEADERS; captured by saving once.
async function fingerprintFor(headers: string[]): Promise<string> {
  const { prisma, created } = fakePrisma([]);
  await saveTemplate(prisma, { organizationId: ORG, sourceType: "csv", headers, mappings: MAPPINGS });
  return (created[0] as { headerFingerprint: string }).headerFingerprint;
}

describe("saveTemplate", () => {
  it("creates version 1 when nothing exists", async () => {
    const { prisma, created } = fakePrisma([]);
    const r = await saveTemplate(prisma, {
      organizationId: ORG, sourceType: "csv", headers: HEADERS, mappings: MAPPINGS,
    });
    expect(r).toMatchObject({ version: 1, created: true });
    expect(created).toHaveLength(1);
  });

  it("does NOT create a new version when the mapping is unchanged but JSONB reordered the keys", async () => {
    // The regression: stored keys come back in JSONB order, the incoming
    // mapping is in client order. Order-sensitive comparison minted a version
    // on every re-import.
    const fp = await fingerprintFor(HEADERS);
    const { prisma, created, updated } = fakePrisma([
      { id: "tpl-1", version: 1, mappings: MAPPINGS, headerFingerprint: fp },
    ]);

    const reordered = Object.fromEntries(Object.entries(MAPPINGS).reverse());
    const r = await saveTemplate(prisma, {
      organizationId: ORG, sourceType: "csv", headers: HEADERS, mappings: reordered,
    });

    expect(r).toMatchObject({ version: 1, created: false });
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });

  it("creates a new version when the mapping genuinely changed", async () => {
    const fp = await fingerprintFor(HEADERS);
    const { prisma, created } = fakePrisma([
      { id: "tpl-1", version: 1, mappings: MAPPINGS, headerFingerprint: fp },
    ]);
    const changed = { ...MAPPINGS, short_description: "description" };
    const r = await saveTemplate(prisma, {
      organizationId: ORG, sourceType: "csv", headers: HEADERS, mappings: changed,
    });
    expect(r).toMatchObject({ version: 2, created: true });
    expect(created).toHaveLength(1);
  });

  it("replace mode overwrites the newest instead of versioning", async () => {
    const fp = await fingerprintFor(HEADERS);
    const { prisma, created, updated } = fakePrisma([
      { id: "tpl-1", version: 1, mappings: MAPPINGS, headerFingerprint: fp },
    ]);
    const changed = { ...MAPPINGS, product_name: "name" };
    const r = await saveTemplate(prisma, {
      organizationId: ORG, sourceType: "csv", headers: HEADERS, mappings: changed, mode: "replace",
    });
    expect(r).toMatchObject({ created: false });
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
  });

  it("ignores empty mapping values and saves nothing when all are empty", async () => {
    const { prisma, created } = fakePrisma([]);
    expect(await saveTemplate(prisma, {
      organizationId: ORG, sourceType: "csv", headers: HEADERS, mappings: { sku: "", gtin: "" },
    })).toBeNull();
    expect(created).toHaveLength(0);
  });
});
