import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ImportService } from "../services/import.service.js";
import { acquireLease, transition, queueStats } from "./import-job.repository.js";
import { writeAuditLog } from "../services/audit.service.js";

/**
 * In-process import worker (Phase 1.0.2, Increment A).
 *
 * App Service is pinned to a single instance, so one poller inside the Fastify
 * process is sufficient and adds no deployment surface. The lease protocol is
 * nonetheless written to be correct for several workers, because leasing is
 * cheap to build now and expensive to retrofit if the app is ever scaled out.
 *
 * The worker never receives tenant context. It derives organization and catalog
 * from the batch it leased, so a background run carries exactly the same
 * isolation guarantees as a request-bound one.
 */

export interface WorkerOptions {
  pollIntervalMs?: number;
  leaseMs?: number;
  chunkSize?: number;
  /** Structured logger; must never be handed raw product payloads. */
  log?: (entry: Record<string, unknown>) => void;
}

export class ImportWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly chunkSize: number;
  private readonly log: (entry: Record<string, unknown>) => void;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  /** Resolves once an in-flight job finishes, so shutdown can wait for it. */
  private active: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly importService: ImportService,
    options: WorkerOptions = {},
  ) {
    this.workerId = `${process.env.WEBSITE_INSTANCE_ID ?? "local"}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.chunkSize = options.chunkSize ?? 100;
    this.log = options.log ?? (() => {});
  }

  get id(): string {
    return this.workerId;
  }

  start(): void {
    if (this.timer) return;
    this.log({ event: "import_worker.started", workerId: this.workerId,
               pollIntervalMs: this.pollIntervalMs, leaseMs: this.leaseMs, chunkSize: this.chunkSize });
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    // Do not hold the process open purely to poll.
    this.timer.unref?.();
  }

  /** Stops polling and waits for any in-flight job to reach a safe point. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.active;
    this.log({ event: "import_worker.stopped", workerId: this.workerId });
  }

  /**
   * One poll cycle. Exposed for tests so they can drive the worker
   * deterministically instead of waiting on an interval.
   */
  async tick(): Promise<boolean> {
    // Single-flight: a slow import must not have a second tick pile up behind it.
    if (this.running || this.stopping) return false;
    this.running = true;

    let resolveActive: () => void = () => {};
    this.active = new Promise<void>((r) => { resolveActive = r; });

    try {
      const leased = await acquireLease(this.prisma, {
        workerId: this.workerId,
        leaseMs: this.leaseMs,
      });
      if (!leased) return false;

      const isRetry = leased.attempts > 1;
      this.log({ event: "import.processing_started", importBatchId: leased.id,
                 workerId: this.workerId, attempt: leased.attempts,
                 resumeFrom: leased.progressRows, totalRows: leased.totalRows });

      await this.audit(leased.organizationId, isRetry ? "import.retry_started" : "import.processing_started",
                       leased.id, { attempt: leased.attempts, resumeFrom: leased.progressRows });

      try {
        const results = await this.importService.executeImport(leased.id, {
          workerId: this.workerId,
          leaseMs: this.leaseMs,
          chunkSize: this.chunkSize,
          log: this.log,
        });

        await this.audit(
          leased.organizationId,
          results.status === "cancelled" ? "import.cancelled" : "import.completed",
          leased.id,
          {
            status: results.status,
            createdProducts: results.createdProducts,
            updatedProducts: results.updatedProducts,
            failedRows: results.failedRows,
            durationMs: results.durationMs,
          },
        );
      } catch (err) {
        await this.handleFailure(leased, err);
      }

      return true;
    } catch (err) {
      // A failure to even acquire a lease must not kill the poll loop.
      this.log({ event: "import_worker.tick_error", workerId: this.workerId,
                 message: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      this.running = false;
      resolveActive();
    }
  }

  /**
   * Records a failed attempt.
   *
   * Below max_attempts the job returns to `queued` and another cycle retries it
   * from committed progress; at the limit it becomes terminally `failed` with
   * diagnostics retained. Either way the lease is released so the job is not
   * stranded waiting for expiry.
   */
  private async handleFailure(
    leased: { id: string; organizationId: string; attempts: number },
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: leased.id },
      select: { attempts: true, maxAttempts: true, status: true, progressRows: true },
    });

    // A terminal status means executeImport already finished the job and the
    // error came from something after it; nothing to transition.
    if (!batch || ["completed", "completed_with_warnings", "failed", "cancelled"].includes(batch.status)) {
      this.log({ event: "import.post_terminal_error", importBatchId: leased.id, message });
      return;
    }

    const exhausted = batch.attempts >= batch.maxAttempts;
    this.log({ event: "import.attempt_failed", importBatchId: leased.id, workerId: this.workerId,
               attempt: batch.attempts, maxAttempts: batch.maxAttempts, exhausted, message });

    await transition(this.prisma, leased.id, exhausted ? "failed" : "queued", {
      errorCode: exhausted ? "PROCESSING_FAILED" : "ATTEMPT_FAILED",
      errorMessage: message.slice(0, 2000),
      releaseLease: true,
    });

    if (exhausted) {
      await this.audit(leased.organizationId, "import.failed", leased.id, {
        attempts: batch.attempts,
        progressRows: batch.progressRows,
        errorCode: "PROCESSING_FAILED",
      });
    }
  }

  /** Lifecycle events only — never one entry per row. */
  private async audit(
    organizationId: string,
    action: string,
    importBatchId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(this.prisma, {
      organizationId,
      action,
      resourceType: "import_batch",
      resourceId: importBatchId,
      result: action === "import.failed" ? "failure" : "success",
      metadata,
    }).catch(() => {
      // Audit must never break processing.
    });
  }

  /** Queue depth and oldest-queued age, for periodic observability. */
  async stats(): Promise<{ queued: number; processing: number; oldestQueuedAgeMs: number | null }> {
    return queueStats(this.prisma);
  }
}
