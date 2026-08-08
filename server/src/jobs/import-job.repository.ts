import type { PrismaClient, Prisma } from "@prisma/client";
import {
  assertTransition,
  timestampsFor,
  type ImportState,
} from "./import-state.js";

/**
 * Job-execution persistence for imports (Phase 1.0.2, Increment A).
 *
 * ImportBatch doubles as the job record, but every job concern lives here —
 * leasing, heartbeat, reclaim, retry accounting — so extracting a dedicated
 * ImportJob table later means changing this file, not the import service.
 *
 * Nothing here reads tenant context. A worker derives organization and catalog
 * from the persisted batch it leased, never from client input.
 */

export interface LeaseOptions {
  workerId: string;
  /** How long a lease is valid without a heartbeat. */
  leaseMs: number;
}

export interface LeasedBatch {
  id: string;
  organizationId: string;
  catalogId: string;
  attempts: number;
  progressRows: number;
  totalRows: number;
}

/**
 * Atomically claims one due job.
 *
 * Correctness rests on the WHERE clause doing the arbitration: the UPDATE only
 * matches rows still visible as claimable, so two concurrent workers cannot
 * both match the same row. `FOR UPDATE SKIP LOCKED` inside the subquery means a
 * second worker steps over a row another worker is claiming rather than
 * blocking on it.
 *
 * Claims either a `queued` job or a `processing` job whose lease has expired —
 * the latter is how a worker that died mid-import is recovered.
 */
export async function acquireLease(
  prisma: PrismaClient,
  { workerId, leaseMs }: LeaseOptions,
): Promise<LeasedBatch | null> {
  const now = new Date();
  const expiry = new Date(now.getTime() + leaseMs);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    organization_id: string;
    catalog_id: string;
    attempts: number;
    progress_rows: number;
    total_rows: number;
  }>>`
    UPDATE import_batch AS b
       SET status          = 'processing',
           locked_by       = ${workerId},
           lock_expires_at = ${expiry},
           heartbeat_at    = ${now},
           started_at      = COALESCE(b.started_at, ${now}),
           attempts        = b.attempts + 1,
           updated_at      = ${now}
     WHERE b.id = (
             SELECT c.id
               FROM import_batch c
              WHERE (
                      c.status = 'queued'
                      OR (c.status = 'processing' AND c.lock_expires_at < ${now})
                    )
                AND c.attempts < c.max_attempts
              ORDER BY c.queued_at NULLS LAST, c.created_at
              LIMIT 1
              FOR UPDATE SKIP LOCKED
           )
    RETURNING b.id, b.organization_id, b.catalog_id,
              b.attempts, b.progress_rows, b.total_rows;
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    catalogId: row.catalog_id,
    attempts: row.attempts,
    progressRows: row.progress_rows,
    totalRows: row.total_rows,
  };
}

/**
 * Extends the lease and proves liveness.
 *
 * Scoped to `locked_by` so a worker that lost its lease to a reclaim cannot
 * resurrect it; the returned count tells the caller whether it still owns the job.
 */
export async function heartbeat(
  prisma: PrismaClient,
  batchId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.importBatch.updateMany({
    where: { id: batchId, lockedBy: workerId, status: "processing" },
    data: { heartbeatAt: now, lockExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return result.count === 1;
}

/** True when the operator has asked to stop. Checked at chunk boundaries. */
export async function isCancellationRequested(
  prisma: PrismaClient,
  batchId: string,
): Promise<boolean> {
  const row = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { cancelRequestedAt: true },
  });
  return row?.cancelRequestedAt != null;
}

export interface TransitionData {
  errorCode?: string | null;
  errorMessage?: string | null;
  progressRows?: number;
  successfulRows?: number;
  warningRows?: number;
  failedRows?: number;
  errorSummary?: Prisma.InputJsonValue;
  releaseLease?: boolean;
}

/**
 * Moves a batch to a new state, rejecting illegal transitions.
 *
 * Reads the current status and writes in one transaction so a concurrent
 * reclaim cannot slip between the check and the write.
 */
export async function transition(
  prisma: PrismaClient,
  batchId: string,
  to: ImportState,
  data: TransitionData = {},
): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.importBatch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (!current) throw new Error(`Import batch not found: ${batchId}`);

    assertTransition(current.status, to);

    const { releaseLease, ...rest } = data;
    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        status: to,
        ...timestampsFor(to, now),
        ...rest,
        ...(releaseLease ? { lockedBy: null, lockExpiresAt: null } : {}),
      },
    });
  });
}

/**
 * Advances committed progress.
 *
 * Must be called with a transaction client that is also committing the rows it
 * counts, so progress can never run ahead of durable work.
 */
export async function advanceProgress(
  tx: Prisma.TransactionClient,
  batchId: string,
  progressRows: number,
): Promise<void> {
  await tx.importBatch.update({
    where: { id: batchId },
    data: { progressRows },
  });
}

/** Queue depth and oldest-queued age, for observability. */
export async function queueStats(prisma: PrismaClient): Promise<{
  queued: number;
  processing: number;
  oldestQueuedAgeMs: number | null;
}> {
  const [queued, processing, oldest] = await Promise.all([
    prisma.importBatch.count({ where: { status: "queued" } }),
    prisma.importBatch.count({ where: { status: "processing" } }),
    prisma.importBatch.findFirst({
      where: { status: "queued" },
      orderBy: { queuedAt: "asc" },
      select: { queuedAt: true },
    }),
  ]);
  return {
    queued,
    processing,
    oldestQueuedAgeMs: oldest?.queuedAt ? Date.now() - oldest.queuedAt.getTime() : null,
  };
}
