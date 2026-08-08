import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ImportService } from "../../src/services/import.service.js";
import { MAX_ROWS_PER_INSERT } from "../../src/services/import-chunk.js";
import { createStorageProvider } from "../../src/storage/storage.factory.js";
import { loadConfig } from "../../src/config.js";
import type { TenantContext } from "../../src/auth/types.js";

/**
 * Query-count regression (Phase 1.0.2, Increment B, step 8).
 *
 * Increment B's whole claim is that database work stopped scaling with source
 * rows and started scaling with chunks. A benchmark demonstrates that once; a
 * test keeps it true. These count the statements Prisma actually issues during
 * a real import and assert bounds that per-row matching or per-field inserts
 * could not satisfy.
 *
 * The bounds are deliberately loose — several times the measured value — so
 * they fail on a regression in kind rather than on a change in degree. The
 * measured numbers are recorded in the assertions' comments, not in the
 * assertions themselves.
 *
 * What each bound would catch:
 *
 *   canonical_product   a per-row match query, or a per-row read before update
 *   field_provenance    the per-field insert loop
 *   source_record       the per-row insert
 *   import_batch        the per-row resume-pointer write
 *   transactions        the per-row transaction
 */

const ORG = "80000000-0000-0000-0000-000000000001";
const CATALOG = "80000000-0000-0000-0000-000000000002";

const config = loadConfig();
const storage = createStorageProvider(config.storage);

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });

const ctx = {
  organizationId: ORG, catalogId: CATALOG, userId: "scaling-test",
  role: "organization_admin", displayName: "scaling-test",
} as unknown as TenantContext;

const MAPPINGS = {
  sku: "sku", brand: "brand", product_name: "title",
  long_description: "description", category: "category",
} as const;

interface Counts {
  total: number;
  transactions: number;
  byTable: Record<string, number>;
}

const counts: Counts = { total: 0, transactions: 0, byTable: {} };

function resetCounts(): void {
  counts.total = 0;
  counts.transactions = 0;
  for (const key of Object.keys(counts.byTable)) delete counts.byTable[key];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on("query", (e: { query: string }) => {
  counts.total++;
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(e.query)) {
    if (/^\s*BEGIN/i.test(e.query)) counts.transactions++;
    return;
  }
  const match = e.query.match(/(?:FROM|INTO|UPDATE)\s+"?public"?\.?"?([a-z_]+)"?/i);
  const table = match?.[1] ?? "other";
  counts.byTable[table] = (counts.byTable[table] ?? 0) + 1;
});

function makeCsv(rows: number, tag: string): Buffer {
  const header = "sku,gtin,brand,title,description,category\n";
  const lines: string[] = [];
  for (let i = 1; i <= rows; i++) {
    lines.push(`SCALE-${tag}-${String(i).padStart(6, "0")},,ScaleCo,Product ${i},Description ${i},Cat ${i % 7}`);
  }
  return Buffer.from(header + lines.join("\n"), "utf-8");
}

interface Measurement {
  rows: number;
  chunkSize: number;
  chunks: number;
  statements: number;
  statementsPerRow: number;
  transactions: number;
  byTable: Record<string, number>;
}

/** Runs a real import and returns what the database was asked to do. */
async function measure(rows: number, chunkSize: number, tag: string): Promise<Measurement> {
  const svc = new ImportService(prisma, storage, config);
  const upload = await svc.uploadAndPreview(ctx, CATALOG, `scale_${tag}.csv`, makeCsv(rows, tag));
  await svc.enqueueImport(ctx, upload.importBatchId, MAPPINGS as never);
  await prisma.importBatch.update({
    where: { id: upload.importBatchId },
    data: {
      status: "processing", lockedBy: "scale-worker", startedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 3_600_000), attempts: 1,
    },
  });

  // Everything above is fixture setup; only the import itself is measured.
  resetCounts();
  const result = await svc.executeImport(upload.importBatchId, {
    workerId: "scale-worker", leaseMs: 600_000, chunkSize,
  });

  expect(result.createdProducts).toBe(rows);
  expect(result.failedRows).toBe(0);

  return {
    rows,
    chunkSize,
    chunks: result.timings.chunks,
    statements: counts.total,
    statementsPerRow: counts.total / rows,
    transactions: counts.transactions,
    byTable: { ...counts.byTable },
  };
}

async function wipe(): Promise<void> {
  await prisma.canonicalProductHistory.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.fieldProvenance.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.sourceRecord.deleteMany({ where: { importBatch: { catalogId: CATALOG } } });
  await prisma.canonicalProduct.deleteMany({ where: { catalogId: CATALOG } });
  await prisma.importBatch.deleteMany({ where: { catalogId: CATALOG } });
}

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG }, update: {},
    create: { id: ORG, name: "[TEST] Query Scaling", slug: `test-scaling-${Date.now()}`, status: "active" },
  });
  await prisma.catalog.upsert({
    where: { id: CATALOG }, update: {},
    create: { id: CATALOG, organizationId: ORG, name: "[TEST] Query Scaling", catalogType: "test" },
  });
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.catalog.deleteMany({ where: { id: CATALOG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

/**
 * Asserts the shape of the work, not its exact quantity.
 *
 * Every bound here is several times the measured value. Each would be violated
 * by an order of magnitude if the per-row behaviour it guards came back.
 */
function assertScalesByChunk(m: Measurement): void {
  // Pre-B was 12 statements per row. Anything that reintroduces a per-row round
  // trip lands at or above 1.0.
  expect(m.statementsPerRow).toBeLessThan(0.5);

  // One transaction per chunk plus a small fixed tail, never one per row.
  expect(m.transactions).toBeLessThanOrEqual(m.chunks + 5);
  expect(m.transactions).toBeLessThan(m.rows / 10);

  // Match query plus bulk create, per chunk. Per-row matching would be `rows`
  // on its own; the pre-B run issued 2 per row.
  expect(m.byTable.canonical_product ?? 0).toBeLessThanOrEqual(m.chunks * 3);

  // Bulk inserts are split to stay inside PostgreSQL's bind-parameter limit, so
  // the ceiling is one statement per full slice plus one per chunk — not one
  // per chunk flat. A row can carry at most eight provenance entries.
  const provenanceCeiling = Math.ceil((m.rows * 8) / MAX_ROWS_PER_INSERT) + m.chunks;
  // Provenance scaled worst of all before: one insert per mapped field per row.
  expect(m.byTable.field_provenance ?? 0).toBeLessThanOrEqual(provenanceCeiling);

  // One bulk insert per slice, never one per row.
  expect(m.byTable.source_record ?? 0)
    .toBeLessThanOrEqual(Math.ceil(m.rows / MAX_ROWS_PER_INSERT) + m.chunks);

  // The resume pointer advances once per chunk, plus heartbeats and the
  // terminal transition.
  expect(m.byTable.import_batch ?? 0).toBeLessThanOrEqual(m.chunks * 3 + 12);
}

describe("database work scales by chunk, not by source row", () => {
  it("500 rows", async () => {
    // Measured 2026-08-07: 37 statements, 0.07/row, 6 transactions, 5 chunks.
    const m = await measure(500, 100, "a500");
    expect(m.chunks).toBe(5);
    assertScalesByChunk(m);
  }, 300_000);

  it("1,000 rows", async () => {
    // Measured 2026-08-07: 67 statements, 0.07/row, 11 transactions, 10 chunks.
    const m = await measure(1000, 100, "b1000");
    expect(m.chunks).toBe(10);
    assertScalesByChunk(m);
  }, 300_000);

  it("statement count follows the chunk count, not the row count", async () => {
    // The direct demonstration: identical files, different chunk sizes. If any
    // per-row work remained, the two runs would cost roughly the same.
    const fine = await measure(1000, 100, "c1000fine");
    await wipe();
    const coarse = await measure(1000, 500, "d1000coarse");

    expect(fine.chunks).toBe(10);
    expect(coarse.chunks).toBe(2);
    expect(coarse.statements).toBeLessThan(fine.statements);
    // Five times fewer chunks must buy a real reduction, not a rounding one.
    expect(coarse.statements).toBeLessThan(fine.statements * 0.75);
    assertScalesByChunk(coarse);
  }, 600_000);
});
