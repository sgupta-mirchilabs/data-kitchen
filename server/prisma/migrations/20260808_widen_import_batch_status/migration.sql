-- Phase 1.0.2 — widen import_batch.status.
--
-- "completed_with_warnings" is 23 characters. The column was VARCHAR(20), so
-- PostgreSQL rejected the write. Every import that produced warnings therefore
-- committed all of its rows and then failed on the terminal transition, was
-- retried, and was reported to the operator as Failed.
--
-- Widening a varchar is a non-destructive, non-rewriting catalog-only change:
-- no existing value is altered, no index is rebuilt, no default is touched.
-- Written by hand; `prisma migrate dev` again proposed unrelated DROP DEFAULT
-- statements across every table, which are excluded.

ALTER TABLE "import_batch" ALTER COLUMN "status" TYPE VARCHAR(40);
