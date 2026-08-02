-- AlterTable: Add catalog_type to catalog
ALTER TABLE "catalog" ADD COLUMN "catalog_type" VARCHAR(20) NOT NULL DEFAULT 'test';

-- Backfill: Existing catalogs get 'test' (the default) — safe backfill,
-- operators should reclassify to 'production' after review.

-- CreateTable: audit_log
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" UUID,
    "request_id" VARCHAR(64),
    "result" VARCHAR(20) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_log_org_time" ON "audit_log"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_log_user" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_log_action" ON "audit_log"("action");

-- AddForeignKey: audit_log.organization_id -> organization.id
-- ON DELETE SET NULL: if an organization is somehow removed, audit records remain
-- with null org_id rather than being cascade-deleted.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
