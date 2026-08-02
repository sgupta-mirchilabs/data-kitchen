-- CreateTable
CREATE TABLE "catalog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_by" VARCHAR(255),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "filename" VARCHAR(500) NOT NULL,
    "file_type" VARCHAR(10) NOT NULL,
    "source_system" VARCHAR(100),
    "uploaded_by" VARCHAR(255),
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "successful_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "file_storage_key" VARCHAR(1000),
    "file_checksum" VARCHAR(128),
    "detected_headers" JSONB,
    "parse_metadata" JSONB,
    "field_mappings" JSONB,
    "error_summary" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "sku" VARCHAR(255),
    "gtin" VARCHAR(14),
    "brand" VARCHAR(255),
    "product_name" VARCHAR(500),
    "short_description" TEXT,
    "long_description" TEXT,
    "category" VARCHAR(255),
    "manufacturer" VARCHAR(255),
    "lifecycle_status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "data_quality_status" VARCHAR(30) NOT NULL DEFAULT 'needs_review',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "packaging" JSONB NOT NULL DEFAULT '{}',
    "compliance" JSONB NOT NULL DEFAULT '{}',
    "digital_assets" JSONB NOT NULL DEFAULT '[]',
    "identifiers" JSONB NOT NULL DEFAULT '{}',
    "created_by" VARCHAR(255),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "canonical_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "source_record_key" VARCHAR(500),
    "raw_payload_json" JSONB NOT NULL,
    "parse_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "parse_errors_json" JSONB,
    "canonical_product_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_product_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_product_id" UUID NOT NULL,
    "field" VARCHAR(255) NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "source_record_id" UUID,
    "actor" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "canonical_product_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_provenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_product_id" UUID NOT NULL,
    "canonical_field" VARCHAR(255) NOT NULL,
    "source_record_id" UUID NOT NULL,
    "source_field" VARCHAR(255) NOT NULL,
    "original_value" TEXT,
    "normalized_value" TEXT,
    "normalization_method" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "field_provenance_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "idx_catalog_org" ON "catalog"("organization_id");
CREATE INDEX "idx_import_batch_catalog" ON "import_batch"("catalog_id");
CREATE INDEX "idx_import_batch_org" ON "import_batch"("organization_id");
CREATE INDEX "idx_product_org" ON "canonical_product"("organization_id");
CREATE INDEX "idx_product_status" ON "canonical_product"("catalog_id", "data_quality_status");
CREATE INDEX "idx_source_record_batch" ON "source_record"("import_batch_id");
CREATE INDEX "idx_source_record_product" ON "source_record"("canonical_product_id");
CREATE UNIQUE INDEX "uq_source_record_batch_row" ON "source_record"("import_batch_id", "row_number");
CREATE INDEX "idx_product_history_product" ON "canonical_product_history"("canonical_product_id");
CREATE INDEX "idx_product_history_time" ON "canonical_product_history"("created_at");
CREATE INDEX "idx_provenance_product" ON "field_provenance"("canonical_product_id");
CREATE INDEX "idx_provenance_source" ON "field_provenance"("source_record_id");

-- Custom: Partial unique index on (catalog_id, sku) WHERE sku IS NOT NULL.
-- Prisma does not support WHERE clauses on @@unique, so this is managed via custom SQL.
-- Prisma's query engine surfaces violations as P2002 errors, which the import service handles.
CREATE UNIQUE INDEX "idx_product_sku_catalog" ON "canonical_product"("catalog_id", "sku") WHERE "sku" IS NOT NULL;

-- Custom: Non-unique index on GTIN for duplicate detection fallback.
CREATE INDEX "idx_product_gtin_catalog" ON "canonical_product"("catalog_id", "gtin") WHERE "gtin" IS NOT NULL;

-- Foreign Keys
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "canonical_product" ADD CONSTRAINT "canonical_product_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_canonical_product_id_fkey" FOREIGN KEY ("canonical_product_id") REFERENCES "canonical_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "canonical_product_history" ADD CONSTRAINT "canonical_product_history_canonical_product_id_fkey" FOREIGN KEY ("canonical_product_id") REFERENCES "canonical_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "canonical_product_history" ADD CONSTRAINT "canonical_product_history_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_canonical_product_id_fkey" FOREIGN KEY ("canonical_product_id") REFERENCES "canonical_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
