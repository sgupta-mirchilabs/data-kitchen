-- Phase 1.0.2 Increment A — persisted import job state.
--
-- Additive only: new nullable/defaulted columns on import_batch, one partial
-- index, and a one-off backfill of interrupted legacy imports.
--
-- NOTE: `prisma migrate dev` proposed 13 unrelated destructive operations —
-- ALTER COLUMN "id" DROP DEFAULT across all ten pre-existing tables plus index
-- renames. Those are artifacts of a newer Prisma emitting client-side UUIDs and
-- would strip the database-level gen_random_uuid() defaults deliberately
-- retained in Phase 1.0.1. They are excluded. Same hazard, same handling.

ALTER TABLE "import_batch"
  ADD COLUMN "queued_at"           TIMESTAMPTZ,
  ADD COLUMN "started_at"          TIMESTAMPTZ,
  ADD COLUMN "completed_at"        TIMESTAMPTZ,
  ADD COLUMN "heartbeat_at"        TIMESTAMPTZ,
  ADD COLUMN "locked_by"           VARCHAR(100),
  ADD COLUMN "lock_expires_at"     TIMESTAMPTZ,
  ADD COLUMN "attempts"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts"        INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "progress_rows"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error_code"          VARCHAR(64),
  ADD COLUMN "error_message"       TEXT,
  ADD COLUMN "cancel_requested_at" TIMESTAMPTZ;

-- Lease acquisition runs on a poll interval. Partial so it indexes only
-- in-flight work rather than the whole import history.
CREATE INDEX "idx_import_batch_queue"
  ON "import_batch" ("status", "lock_expires_at")
  WHERE "status" IN ('queued', 'processing');

-- Backfill: imports left non-terminal by the pre-1.0.2 synchronous pipeline
-- were interrupted by a process restart and can never complete. Mark them
-- terminal so status is trustworthy. Counters and all related records are
-- preserved untouched; these are NOT retried automatically.
UPDATE "import_batch"
   SET "status"        = 'failed',
       "error_code"    = 'LEGACY_INTERRUPTED_IMPORT',
       "error_message" = 'Interrupted before Phase 1.0.2 introduced durable import jobs. Existing records and counters are preserved; this import was not retried automatically.',
       "completed_at"  = COALESCE("completed_at", "updated_at")
 WHERE "status" IN ('pending', 'parsing');
