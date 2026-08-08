import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { advanceProgress } from "../../src/jobs/import-job.repository.js";

/**
 * Durable-resume semantics (Phase 1.0.2).
 *
 * The invariant under test:
 *
 *   progress_rows == the highest FULLY committed source row
 *
 * The original implementation advanced progress only at `rowNumber % chunkSize`
 * boundaries, so a file smaller than one chunk never checkpointed at all and a
 * crash inside a chunk re-ran rows that were already committed. These tests
 * model the real commit shape — one transaction per row, containing the source
 * record, its provenance, its history AND the progress advance — and assert
 * that a crash resumes at exactly the right row.
 */

const ORG = "50000000-0000-0000-0000-000000000001";
const CATALOG = "50000000-0000-0000-0000-000000000002";

const prisma = new PrismaClient();

async function makeBatch(totalRows: number): Promise<string> {
  const b = await prisma.importBatch.create({
    data: {
      organizationId: ORG, catalogId: CATALOG,
      filename: `resume-${totalRows}.csv`, fileType: "csv",
      status: "processing", totalRows, progressRows: 0,
      startedAt: new Date(), lockedBy: "test-worker",
      // Far-future lease so these fixtures are never claimable. acquireLease is
      // deliberately global (one queue), so a short lease expiring during the
      // 42s 250-row test would let another suite — or the live worker — reclaim
      // a fixture batch that points at no real file.
      lockExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return b.id;
}

/**
 * Commits one row exactly as the pipeline does: product, source record,
 * provenance, history and the progress advance in a single transaction.
 * `shouldFail` makes the transaction throw after the writes, modelling a row
 * that errors mid-transaction.
 */
async function commitRow(batchId: string, rowNumber: number, shouldFail = false): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const product = await tx.canonicalProduct.create({
      data: {
        organizationId: ORG, catalogId: CATALOG,
        sku: `RES-${String(rowNumber).padStart(4, "0")}`,
        productName: `Row ${rowNumber}`, lifecycleStatus: "draft",
        dataQualityStatus: "complete",
      },
    });
    const sr = await tx.sourceRecord.create({
      data: {
        importBatchId: batchId, rowNumber,
        sourceRecordKey: product.sku, rawPayloadJson: { row: rowNumber },
        parseStatus: "success", canonicalProductId: product.id,
      },
    });
    await tx.fieldProvenance.create({
      data: {
        canonicalProductId: product.id, canonicalField: "sku",
        sourceRecordId: sr.id, sourceField: "sku",
        originalValue: product.sku, normalizedValue: product.sku,
        normalizationMethod: "trimmed",
      },
    });
    await tx.canonicalProductHistory.create({
      data: {
        canonicalProductId: product.id, field: "product_name",
        previousValue: null, newValue: `Row ${rowNumber}`,
        sourceRecordId: sr.id, actor: "system:import",
      },
    });

    await advanceProgress(tx, batchId, rowNumber);

    if (shouldFail) throw new Error(`simulated failure at row ${rowNumber}`);
  });
}

async function runRows(batchId: string, from: number, to: number, crashAt?: number): Promise<number> {
  for (let r = from; r <= to; r++) {
    if (r === crashAt) throw new Error(`worker died before row ${r}`);
    await commitRow(batchId, r);
  }
  return to;
}

async function counts(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId }, select: { progressRows: true },
  });
  const srs = await prisma.sourceRecord.findMany({
    where: { importBatchId: batchId }, select: { rowNumber: true, canonicalProductId: true },
  });
  const ids = srs.map((s) => s.canonicalProductId).filter((x): x is string => !!x);
  return {
    progressRows: batch.progressRows,
    sourceRecords: srs.length,
    distinctRows: new Set(srs.map((s) => s.rowNumber)).size,
    provenance: await prisma.fieldProvenance.count({ where: { canonicalProductId: { in: ids } } }),
    history: await prisma.canonicalProductHistory.count({ where: { canonicalProductId: { in: ids } } }),
  };
}

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG }, update: {},
    create: { id: ORG, name: "[TEST] Resume Org", slug: `test-resume-${Date.now()}`, status: "active" },
  });
  await prisma.catalog.upsert({
    where: { id: CATALOG }, update: {},
    create: { id: CATALOG, organizationId: ORG, name: "[TEST] Resume Catalog", catalogType: "test" },
  });
});

beforeEach(async () => {
  await prisma.canonicalProductHistory.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.fieldProvenance.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.sourceRecord.deleteMany({ where: { importBatch: { catalogId: CATALOG } } });
  await prisma.canonicalProduct.deleteMany({ where: { catalogId: CATALOG } });
  await prisma.importBatch.deleteMany({ where: { catalogId: CATALOG } });
});

afterAll(async () => {
  await prisma.canonicalProductHistory.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.fieldProvenance.deleteMany({ where: { canonicalProduct: { catalogId: CATALOG } } });
  await prisma.sourceRecord.deleteMany({ where: { importBatch: { catalogId: CATALOG } } });
  await prisma.canonicalProduct.deleteMany({ where: { catalogId: CATALOG } });
  await prisma.importBatch.deleteMany({ where: { catalogId: CATALOG } });
  await prisma.catalog.deleteMany({ where: { id: CATALOG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

describe("progress advances per committed row", () => {
  it("5-row file reaches progress 5 — smaller than any chunk size", async () => {
    const id = await makeBatch(5);
    await runRows(id, 1, 5);
    const c = await counts(id);
    expect(c.progressRows).toBe(5);
    expect(c.sourceRecords).toBe(5);
  });

  it("20-row file reaches progress 20", async () => {
    const id = await makeBatch(20);
    await runRows(id, 1, 20);
    expect((await counts(id)).progressRows).toBe(20);
  });

  it("advances on every row, not only at boundaries", async () => {
    const id = await makeBatch(7);
    for (let r = 1; r <= 7; r++) {
      await commitRow(id, r);
      const { progressRows } = await prisma.importBatch.findUniqueOrThrow({
        where: { id }, select: { progressRows: true },
      });
      expect(progressRows).toBe(r);
    }
  });
});

describe("250-row file, crash at row 180", () => {
  // 321 row-transactions against a remote database; the default 30s is not
  // enough. The duration itself is a data point for Increment B's throughput
  // work, not a defect in the resume logic.
  it("resumes at 181 with no duplicated source, provenance or history", async () => {
    const id = await makeBatch(250);

    await expect(runRows(id, 1, 250, 180)).rejects.toThrow("worker died before row 180");

    const afterCrash = await counts(id);
    // 179 rows committed; the pointer must say exactly that.
    expect(afterCrash.progressRows).toBe(179);
    expect(afterCrash.sourceRecords).toBe(179);

    // Resume exactly where the pointer says.
    const resumeFrom = afterCrash.progressRows;
    expect(resumeFrom + 1).toBe(180);

    await runRows(id, resumeFrom + 1, 250);

    const final = await counts(id);
    expect(final.progressRows).toBe(250);
    expect(final.sourceRecords).toBe(250);
    // The unique index would have rejected a replay; distinct == total proves
    // no row was processed twice.
    expect(final.distinctRows).toBe(250);
    expect(final.provenance).toBe(250);
    expect(final.history).toBe(250);
  }, 240_000);

  it("replaying a committed row is rejected, leaving counts unchanged", async () => {
    const id = await makeBatch(10);
    await runRows(id, 1, 10);
    const before = await counts(id);

    // The defensive backstop: the same (batch, row) cannot be written twice.
    await expect(commitRow(id, 5)).rejects.toThrow();

    const after = await counts(id);
    expect(after).toEqual(before);
  });
});

describe("failed rows do not advance the pointer", () => {
  it("a row whose transaction throws leaves progress at the previous row", async () => {
    const id = await makeBatch(10);
    await runRows(id, 1, 4);
    expect((await counts(id)).progressRows).toBe(4);

    await expect(commitRow(id, 5, true)).rejects.toThrow("simulated failure at row 5");

    const c = await counts(id);
    expect(c.progressRows).toBe(4);
    // Nothing from the failed row survives — product, source, provenance and
    // history all rolled back with the pointer.
    expect(c.sourceRecords).toBe(4);
    expect(c.provenance).toBe(4);
    expect(c.history).toBe(4);
  });
});

describe("terminal status persistence", () => {
  it("completed_with_warnings persists — the 23-character status that used to be rejected", async () => {
    const id = await makeBatch(5);
    await prisma.importBatch.update({
      where: { id }, data: { status: "completed_with_warnings", completedAt: new Date() },
    });
    const b = await prisma.importBatch.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(b.status).toBe("completed_with_warnings");
  });
});
