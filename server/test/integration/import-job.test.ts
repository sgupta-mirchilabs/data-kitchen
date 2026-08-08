import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  acquireLease,
  heartbeat,
  transition,
  advanceProgress,
  isCancellationRequested,
  queueStats,
} from "../../src/jobs/import-job.repository.js";
import { InvalidImportTransitionError } from "../../src/jobs/import-state.js";

/**
 * Phase 1.0.2 Increment A — durability acceptance tests.
 *
 * These exercise the lease protocol against a real PostgreSQL instance, because
 * the correctness of `FOR UPDATE SKIP LOCKED` and the arbitration in the UPDATE
 * ... WHERE clause cannot be demonstrated against a stub.
 */

const ORG = "40000000-0000-0000-0000-000000000001";
const CATALOG = "40000000-0000-0000-0000-000000000002";

const prisma = new PrismaClient();
let batchSeq = 0;

async function makeBatch(overrides: Record<string, unknown> = {}): Promise<string> {
  const batch = await prisma.importBatch.create({
    data: {
      organizationId: ORG,
      catalogId: CATALOG,
      filename: `job-test-${++batchSeq}.csv`,
      fileType: "csv",
      status: "queued",
      totalRows: 100,
      queuedAt: new Date(),
      ...overrides,
    },
  });
  return batch.id;
}

async function statusOf(id: string) {
  return prisma.importBatch.findUniqueOrThrow({
    where: { id },
    select: {
      status: true, lockedBy: true, lockExpiresAt: true, attempts: true,
      progressRows: true, errorCode: true, errorMessage: true,
      startedAt: true, completedAt: true, heartbeatAt: true,
    },
  });
}

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG },
    update: {},
    create: { id: ORG, name: "[TEST] Job Org", slug: `test-job-org-${Date.now()}`, status: "active" },
  });
  await prisma.catalog.upsert({
    where: { id: CATALOG },
    update: {},
    create: { id: CATALOG, organizationId: ORG, name: "[TEST] Job Catalog", catalogType: "test" },
  });
});

beforeEach(async () => {
  // Isolate each test from queued rows left by another.
  await prisma.importBatch.deleteMany({ where: { organizationId: ORG } });
});

afterAll(async () => {
  await prisma.importBatch.deleteMany({ where: { organizationId: ORG } });
  await prisma.catalog.deleteMany({ where: { id: CATALOG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

describe("lease acquisition", () => {
  it("claims a queued job and marks it processing", async () => {
    const id = await makeBatch();
    const leased = await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });

    expect(leased?.id).toBe(id);
    const s = await statusOf(id);
    expect(s.status).toBe("processing");
    expect(s.lockedBy).toBe("w1");
    expect(s.attempts).toBe(1);
    expect(s.startedAt).not.toBeNull();
  });

  it("only one of two concurrent workers wins the same job", async () => {
    const id = await makeBatch();
    const [a, b] = await Promise.all([
      acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 }),
      acquireLease(prisma, { workerId: "w2", leaseMs: 60_000 }),
    ]);

    const winners = [a, b].filter((x) => x?.id === id);
    expect(winners).toHaveLength(1);

    const s = await statusOf(id);
    expect(["w1", "w2"]).toContain(s.lockedBy);
    // Crucially the loser must not have incremented attempts on this row.
    expect(s.attempts).toBe(1);
  });

  it("returns null when nothing is due", async () => {
    expect(await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 })).toBeNull();
  });

  it("does not claim a job whose lease is still valid", async () => {
    await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    expect(await acquireLease(prisma, { workerId: "w2", leaseMs: 60_000 })).toBeNull();
  });

  it("reclaims a job whose lease expired — the app-restart case", async () => {
    // Simulates a worker that died mid-import without releasing.
    const id = await makeBatch({
      status: "processing",
      lockedBy: "dead-worker",
      lockExpiresAt: new Date(Date.now() - 1000),
      attempts: 1,
      progressRows: 40,
    });

    const leased = await acquireLease(prisma, { workerId: "w2", leaseMs: 60_000 });
    expect(leased?.id).toBe(id);
    // Progress survives the restart, so the retry resumes rather than restarts.
    expect(leased?.progressRows).toBe(40);

    const s = await statusOf(id);
    expect(s.lockedBy).toBe("w2");
    expect(s.attempts).toBe(2);
  });

  it("stops reclaiming once attempts reach max_attempts", async () => {
    await makeBatch({
      status: "processing",
      lockedBy: "dead",
      lockExpiresAt: new Date(Date.now() - 1000),
      attempts: 3,
      maxAttempts: 3,
    });
    expect(await acquireLease(prisma, { workerId: "w2", leaseMs: 60_000 })).toBeNull();
  });
});

describe("heartbeat", () => {
  it("extends the lease for the owning worker", async () => {
    const id = await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 5_000 });
    const before = (await statusOf(id)).lockExpiresAt!;

    await new Promise((r) => setTimeout(r, 50));
    expect(await heartbeat(prisma, id, "w1", 60_000)).toBe(true);
    expect((await statusOf(id)).lockExpiresAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  it("tells a worker that lost its lease that it no longer owns the job", async () => {
    const id = await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    // Another worker reclaimed it.
    await prisma.importBatch.update({ where: { id }, data: { lockedBy: "w2" } });
    expect(await heartbeat(prisma, id, "w1", 60_000)).toBe(false);
  });
});

describe("progress and durability", () => {
  it("advances progress inside a caller-supplied transaction", async () => {
    const id = await makeBatch();
    await prisma.$transaction(async (tx) => advanceProgress(tx, id, 250));
    expect((await statusOf(id)).progressRows).toBe(250);
  });

  it("does not persist progress when the surrounding transaction rolls back", async () => {
    // This is the property that stops progress claiming uncommitted work.
    const id = await makeBatch();
    await expect(
      prisma.$transaction(async (tx) => {
        await advanceProgress(tx, id, 999);
        throw new Error("simulated chunk failure");
      }),
    ).rejects.toThrow("simulated chunk failure");

    expect((await statusOf(id)).progressRows).toBe(0);
  });
});

describe("guarded transitions", () => {
  it("records diagnostics on failure", async () => {
    const id = await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    await transition(prisma, id, "failed", {
      errorCode: "PROCESSING_FAILED",
      errorMessage: "boom",
      releaseLease: true,
    });

    const s = await statusOf(id);
    expect(s.status).toBe("failed");
    expect(s.errorCode).toBe("PROCESSING_FAILED");
    expect(s.errorMessage).toBe("boom");
    expect(s.completedAt).not.toBeNull();
    expect(s.lockedBy).toBeNull();
  });

  it("rejects an illegal transition rather than corrupting status", async () => {
    const id = await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    await transition(prisma, id, "completed", { releaseLease: true });

    await expect(transition(prisma, id, "processing")).rejects.toThrow(InvalidImportTransitionError);
    expect((await statusOf(id)).status).toBe("completed");
  });

  it("allows retry from failed back to queued", async () => {
    const id = await makeBatch({ status: "failed" });
    await transition(prisma, id, "queued");
    expect((await statusOf(id)).status).toBe("queued");
  });
});

describe("cancellation", () => {
  it("reports a cancellation request", async () => {
    const id = await makeBatch();
    expect(await isCancellationRequested(prisma, id)).toBe(false);
    await prisma.importBatch.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    expect(await isCancellationRequested(prisma, id)).toBe(true);
  });

  it("cancels a queued job immediately", async () => {
    const id = await makeBatch();
    await transition(prisma, id, "cancelled", { releaseLease: true });
    const s = await statusOf(id);
    expect(s.status).toBe("cancelled");
    expect(s.progressRows).toBe(0);
  });

  it("preserves committed progress when a processing job is cancelled", async () => {
    // Committed rows are never rolled back; the count must survive.
    const id = await makeBatch();
    await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    await prisma.$transaction(async (tx) => advanceProgress(tx, id, 300));
    await transition(prisma, id, "cancelled", { releaseLease: true });

    const s = await statusOf(id);
    expect(s.status).toBe("cancelled");
    expect(s.progressRows).toBe(300);
  });
});

describe("observability", () => {
  it("reports queue depth and oldest queued age", async () => {
    await makeBatch({ queuedAt: new Date(Date.now() - 5000) });
    await makeBatch();
    const stats = await queueStats(prisma);
    expect(stats.queued).toBeGreaterThanOrEqual(2);
    expect(stats.oldestQueuedAgeMs).toBeGreaterThanOrEqual(4000);
  });
});

describe("tenant scoping", () => {
  it("a leased job carries the organization and catalog from the persisted row", async () => {
    // The worker never receives tenant context; it must come from the batch.
    const id = await makeBatch();
    const leased = await acquireLease(prisma, { workerId: "w1", leaseMs: 60_000 });
    expect(leased?.id).toBe(id);
    expect(leased?.organizationId).toBe(ORG);
    expect(leased?.catalogId).toBe(CATALOG);
  });
});
