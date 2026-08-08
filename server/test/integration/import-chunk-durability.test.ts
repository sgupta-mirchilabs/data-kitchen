import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ImportService } from "../../src/services/import.service.js";
import { createStorageProvider } from "../../src/storage/storage.factory.js";
import { loadConfig } from "../../src/config.js";
import type { TenantContext } from "../../src/auth/types.js";

/**
 * Durability of the chunked pipeline (Phase 1.0.2, Increment B, step 7).
 *
 * `import-resume.test.ts` proves the invariant against a hand-written commit
 * shape. These drive the real `executeImport` against a real PostgreSQL
 * instance, because Increment B moved the transaction boundary from the row to
 * the chunk and the invariant has to survive that move unchanged:
 *
 *   progress_rows == the highest FULLY committed source row
 *
 * A chunk commits its writes and its resume pointer together, so there is no
 * interval in which progress can describe work that is not durable. Every test
 * below attacks that from a different direction: a bulk commit that fails, a
 * row that can never be written, an attempt that dies mid-file, and a retry
 * that must not write anything twice.
 */

const ORG = "70000000-0000-0000-0000-000000000001";
const CATALOG = "70000000-0000-0000-0000-000000000002";

const config = loadConfig();
const prisma = new PrismaClient();
const storage = createStorageProvider(config.storage);

const ctx = {
  organizationId: ORG, catalogId: CATALOG, userId: "durability-test",
  role: "organization_admin", displayName: "durability-test",
} as unknown as TenantContext;

const MAPPINGS = {
  sku: "sku", brand: "brand", product_name: "title",
  long_description: "description", category: "category",
} as const;

function makeCsv(rows: number, poisonRow?: number): Buffer {
  const header = "sku,gtin,brand,title,description,category\n";
  const lines: string[] = [];
  for (let i = 1; i <= rows; i++) {
    // A SKU past VARCHAR(255) cannot be written however it is batched, which is
    // what makes it a faithful stand-in for a genuinely unimportable row.
    const sku = i === poisonRow ? "X".repeat(300) : `DUR-${String(i).padStart(5, "0")}`;
    lines.push(`${sku},,DurCo,Product ${i},Description ${i},Cat ${i % 5}`);
  }
  return Buffer.from(header + lines.join("\n"), "utf-8");
}

/**
 * Makes the Nth interactive transaction fail.
 *
 * Used to prove that a chunk's bulk commit leaves nothing behind: the pipeline
 * replays the chunk a row at a time, and the (import_batch_id, row_number)
 * unique index would reject that replay if the failed bulk attempt had leaked
 * even one source record.
 */
function interceptTransactions(
  before: (call: number) => Promise<void> | void,
): PrismaClient {
  let calls = 0;
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async (...args: unknown[]) => {
          await before(++calls);
          return (target as unknown as Record<string, (...a: unknown[]) => unknown>)
            .$transaction(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

/** Fails the transactions the predicate selects, letting the rest through. */
function prismaFailingTransaction(shouldFail: (call: number) => boolean): PrismaClient {
  return interceptTransactions((call) => {
    if (shouldFail(call)) throw new Error(`simulated commit failure #${call}`);
  });
}

/**
 * Slows every chunk transaction past the liveness interval, so the lease is
 * checked at every chunk boundary instead of only on the last one.
 *
 * This is what makes "the attempt dies after chunk 1" deterministic rather than
 * a race against how fast the database happens to be that afternoon.
 */
function prismaSlowTransaction(delayMs: number): PrismaClient {
  return interceptTransactions(() => new Promise((r) => setTimeout(r, delayMs)));
}

function service(client: PrismaClient = prisma): ImportService {
  return new ImportService(client, storage, config);
}

/** Uploads a file and leaves the batch leased and processing, ready to execute. */
async function stage(rows: number, poisonRow?: number): Promise<string> {
  const svc = service();
  const upload = await svc.uploadAndPreview(ctx, CATALOG, `dur_${rows}_${Date.now()}.csv`, makeCsv(rows, poisonRow));
  // `acquireLease` deliberately arbitrates over one global queue, so a fixture
  // sitting at `queued` — even for the moment between enqueue and claim — is
  // claimable by any other suite running in parallel. max_attempts = 0 fails
  // the `attempts < max_attempts` guard, making these batches invisible to it.
  // These tests drive `executeImport` directly and never lease.
  await prisma.importBatch.update({ where: { id: upload.importBatchId }, data: { maxAttempts: 0 } });
  await svc.enqueueImport(ctx, upload.importBatchId, MAPPINGS as never);
  await claim(upload.importBatchId);
  return upload.importBatchId;
}

/** Puts a batch into the state a worker holding a valid lease would leave. */
async function claim(id: string, workerId = "dur-worker"): Promise<void> {
  await prisma.importBatch.update({
    where: { id },
    data: {
      status: "processing", lockedBy: workerId, startedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 3_600_000), attempts: 1,
    },
  });
}

async function counts(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { progressRows: true, status: true, successfulRows: true, failedRows: true, totalRows: true },
  });
  const sourceRecords = await prisma.sourceRecord.findMany({
    where: { importBatchId: batchId },
    select: { rowNumber: true, canonicalProductId: true, parseStatus: true },
  });
  const productIds = sourceRecords
    .map((s) => s.canonicalProductId)
    .filter((x): x is string => !!x);

  return {
    ...batch,
    sourceRecords: sourceRecords.length,
    distinctRows: new Set(sourceRecords.map((s) => s.rowNumber)).size,
    errorRows: sourceRecords.filter((s) => s.parseStatus === "error").length,
    products: await prisma.canonicalProduct.count({ where: { catalogId: CATALOG } }),
    provenance: await prisma.fieldProvenance.count({
      where: { canonicalProductId: { in: productIds } },
    }),
    history: await prisma.canonicalProductHistory.count({
      where: { canonicalProductId: { in: productIds } },
    }),
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
    create: { id: ORG, name: "[TEST] Chunk Durability", slug: `test-chunk-dur-${Date.now()}`, status: "active" },
  });
  await prisma.catalog.upsert({
    where: { id: CATALOG }, update: {},
    create: { id: CATALOG, organizationId: ORG, name: "[TEST] Chunk Durability", catalogType: "test" },
  });
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.catalog.deleteMany({ where: { id: CATALOG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

describe("chunk rollback", () => {
  it("a failed bulk commit leaves nothing behind and the chunk replays row by row", async () => {
    // Transaction #1 is the first chunk's bulk commit. It fails; every row of
    // that chunk is then committed individually. If the rolled-back attempt had
    // leaked a single source record, the replay would violate
    // uq_source_record_batch_row and the row would be counted as failed.
    const id = await stage(50);
    const result = await service(prismaFailingTransaction((call) => call === 1)).executeImport(id, {
      workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.failedRows).toBe(0);
    expect(result.createdProducts).toBe(50);

    const c = await counts(id);
    expect(c.sourceRecords).toBe(50);
    expect(c.distinctRows).toBe(50);
    expect(c.products).toBe(50);
    expect(c.progressRows).toBe(50);
    // 5 mapped fields per row, and none of them written twice.
    expect(c.provenance).toBe(250);
    expect(c.history).toBe(0);
  }, 120_000);

  it("a chunk whose every attempt fails writes no product, provenance or history", async () => {
    const id = await stage(20);
    // Fail the bulk commit and every row of the replay — 1 + 20 transactions —
    // while letting the terminal status transition through, which is what a
    // worker would still manage after giving up on the rows themselves.
    const alwaysFails = prismaFailingTransaction((call) => call <= 21);

    const result = await service(alwaysFails).executeImport(id, {
      workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.status).toBe("failed");
    expect(result.failedRows).toBe(20);
    expect(result.successfulRows).toBe(0);

    const c = await counts(id);
    expect(c.products).toBe(0);
    expect(c.provenance).toBe(0);
    expect(c.history).toBe(0);
    // Only the diagnostic error records, which are written outside any chunk.
    expect(c.errorRows).toBe(20);
  }, 120_000);
});

describe("row-level fault isolation", () => {
  it("one unimportable row costs one row, not its chunk", async () => {
    const id = await stage(30, 17);
    const result = await service().executeImport(id, {
      workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.failedRows).toBe(1);
    expect(result.successfulRows).toBe(29);
    expect(result.errors[0].message).toContain("Row 17");

    const c = await counts(id);
    expect(c.products).toBe(29);
    expect(c.errorRows).toBe(1);
    // The other 29 rows committed exactly once each.
    expect(c.sourceRecords).toBe(30);
    expect(c.distinctRows).toBe(30);
    expect(c.provenance).toBe(29 * 5);
  }, 120_000);
});

describe("an attempt that dies mid-file", () => {
  /**
   * Aborts through the real production path: another worker holds the lease, so
   * the running attempt's next heartbeat fails and it stops rather than
   * committing alongside the new owner. That is exactly the state a crashed and
   * reclaimed worker leaves behind.
   */
  async function abortAfterFirstChunk(rows: number, chunkSize: number): Promise<string> {
    const id = await stage(rows);
    // The lease has already moved on before this attempt starts.
    await prisma.importBatch.update({ where: { id }, data: { lockedBy: "other-worker" } });

    await expect(
      service(prismaSlowTransaction(2_100)).executeImport(id, {
        workerId: "dur-worker", leaseMs: 6_000, chunkSize,
      }),
    ).rejects.toThrow(/Lease lost/);

    return id;
  }

  it("stops on lease loss, and progress names a committed chunk boundary", async () => {
    const id = await abortAfterFirstChunk(300, 100);

    const c = await counts(id);
    expect(c.status).toBe("processing");
    // Progress lands on a chunk boundary, never inside one.
    expect(c.progressRows).toBe(100);
    // And it describes exactly what is durable: the first chunk, entire, and
    // nothing from the chunks that never ran.
    expect(c.sourceRecords).toBe(100);
    expect(c.products).toBe(100);
    expect(c.provenance).toBe(500);
  }, 180_000);

  it("a retry resumes after the highest committed chunk and duplicates nothing", async () => {
    const id = await abortAfterFirstChunk(300, 100);
    const afterCrash = await counts(id);
    expect(afterCrash.progressRows).toBe(100);

    // The reclaim: the lease expires and a second worker takes the job, then
    // resumes from the pointer the first one left.
    await prisma.importBatch.update({
      where: { id },
      data: { lockExpiresAt: new Date(Date.now() - 1000), attempts: 2 },
    });
    await claim(id, "retry-worker");

    const result = await service().executeImport(id, {
      workerId: "retry-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.failedRows).toBe(0);
    // Only the rows the first attempt never reached were processed.
    expect(result.successfulRows).toBe(200);
    expect(result.createdProducts).toBe(200);

    const final = await counts(id);
    expect(final.progressRows).toBe(300);
    expect(final.sourceRecords).toBe(300);
    // The decisive assertion: one source record per row, so no row was
    // committed twice across the two attempts.
    expect(final.distinctRows).toBe(300);
    expect(final.products).toBe(300);
    expect(final.provenance).toBe(1500);
    expect(final.history).toBe(0);
    expect(["completed", "completed_with_warnings"]).toContain(final.status);
  }, 240_000);
});

describe("re-running work that is already committed", () => {
  it("a resumed attempt whose progress covers the file writes nothing further", async () => {
    const id = await stage(100);
    await service().executeImport(id, { workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100 });
    const before = await counts(id);
    expect(before.progressRows).toBe(100);

    // A duplicate delivery: the same batch leased again after completing.
    await prisma.importBatch.update({
      where: { id },
      data: { status: "processing", lockedBy: "dup-worker", lockExpiresAt: new Date(Date.now() + 3_600_000) },
    });
    const again = await service().executeImport(id, {
      workerId: "dup-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(again.successfulRows).toBe(0);
    expect(again.createdProducts).toBe(0);

    const after = await counts(id);
    expect(after.products).toBe(before.products);
    expect(after.sourceRecords).toBe(before.sourceRecords);
    expect(after.provenance).toBe(before.provenance);
    expect(after.history).toBe(before.history);
  }, 120_000);

  it("re-importing the same file as a new batch changes no product and writes no history", async () => {
    // The UNCHANGED path. Every row matches a product that already holds every
    // value the row carries, so the second import writes source records and
    // provenance — the evidence that the rows were seen — and nothing else.
    const first = await stage(100);
    await service().executeImport(first, { workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100 });
    const productsAfterFirst = await prisma.canonicalProduct.findMany({
      where: { catalogId: CATALOG }, select: { id: true, updatedAt: true }, orderBy: { sku: "asc" },
    });

    const second = await stage(100);
    const result = await service().executeImport(second, {
      workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.createdProducts).toBe(0);
    expect(result.updatedProducts).toBe(100);
    expect(result.unchangedProducts).toBe(100);

    const productsAfterSecond = await prisma.canonicalProduct.findMany({
      where: { catalogId: CATALOG }, select: { id: true, updatedAt: true }, orderBy: { sku: "asc" },
    });
    expect(productsAfterSecond).toHaveLength(100);
    expect(productsAfterSecond.map((p) => p.id)).toEqual(productsAfterFirst.map((p) => p.id));
    // No write at all, so not even the timestamp moved.
    expect(productsAfterSecond.map((p) => p.updatedAt.getTime()))
      .toEqual(productsAfterFirst.map((p) => p.updatedAt.getTime()));

    expect(await prisma.canonicalProductHistory.count({
      where: { canonicalProduct: { catalogId: CATALOG } },
    })).toBe(0);
  }, 180_000);

  it("a changed re-import writes history once per changed field", async () => {
    const svc = service();
    const first = await stage(20);
    await svc.executeImport(first, { workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100 });

    // Same SKUs, different names.
    const header = "sku,gtin,brand,title,description,category\n";
    const lines = Array.from({ length: 20 }, (_, i) =>
      `DUR-${String(i + 1).padStart(5, "0")},,DurCo,Renamed ${i + 1},Description ${i + 1},Cat ${(i + 1) % 5}`);
    const upload = await svc.uploadAndPreview(
      ctx, CATALOG, `dur_change_${Date.now()}.csv`, Buffer.from(header + lines.join("\n"), "utf-8"),
    );
    await svc.enqueueImport(ctx, upload.importBatchId, MAPPINGS as never);
    await claim(upload.importBatchId);

    const result = await svc.executeImport(upload.importBatchId, {
      workerId: "dur-worker", leaseMs: 600_000, chunkSize: 100,
    });

    expect(result.createdProducts).toBe(0);
    expect(result.updatedProducts).toBe(20);
    expect(result.unchangedProducts).toBe(0);

    const history = await prisma.canonicalProductHistory.findMany({
      where: { canonicalProduct: { catalogId: CATALOG } },
      select: { field: true },
    });
    // Exactly one entry per product, for the one field that moved.
    expect(history).toHaveLength(20);
    expect(new Set(history.map((h) => h.field))).toEqual(new Set(["product_name"]));
  }, 180_000);
});

describe("chunk size is configuration, not semantics", () => {
  it("produces identical results at chunk sizes 1, 7 and 1000", async () => {
    const outcomes: Array<Record<string, number>> = [];
    for (const chunkSize of [1, 7, 1000]) {
      await wipe();
      const id = await stage(40);
      const result = await service().executeImport(id, {
        workerId: "dur-worker", leaseMs: 600_000, chunkSize,
      });
      const c = await counts(id);
      outcomes.push({
        created: result.createdProducts,
        successful: result.successfulRows,
        products: c.products,
        sourceRecords: c.sourceRecords,
        provenance: c.provenance,
        history: c.history,
        progressRows: c.progressRows,
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  }, 240_000);
});
