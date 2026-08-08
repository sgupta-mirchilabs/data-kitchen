-- Phase 1.0.1 — saved mapping templates.
--
-- Additive only: creates one new table. No existing table is altered.
--
-- NOTE: `prisma migrate dev` also proposed `ALTER COLUMN "id" DROP DEFAULT` on
-- every pre-existing table and two index renames. Those are artifacts of a newer
-- Prisma generating client-side UUIDs rather than a real schema change, and they
-- would strip database-level defaults that existing rows and any non-Prisma
-- insert path rely on. They are deliberately excluded.

CREATE TABLE "mapping_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255),
    "source_type" VARCHAR(10) NOT NULL,
    "header_fingerprint" VARCHAR(64) NOT NULL,
    "headers" JSONB NOT NULL,
    "mappings" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(255),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_template_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_mapping_template_org_type"
    ON "mapping_template"("organization_id", "source_type");

CREATE UNIQUE INDEX "mapping_template_organization_id_source_type_header_fingerp_key"
    ON "mapping_template"("organization_id", "source_type", "header_fingerprint", "version");

ALTER TABLE "mapping_template"
    ADD CONSTRAINT "mapping_template_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
