# Data Kitchen Architecture Decision Record

> **Last updated:** 2026-08-08
> **Scope:** Step 1 — Real Catalog Intake, Canonical Product Model, and Persistence
> **Authors:** Sudu Gupta (Mirchi Labs)

This document is the authoritative record of architectural decisions for Data Kitchen. It explains *why* decisions were made, not how the code works. Future engineers should read this before proposing changes to the system's foundations.

---

## Product Vision

### What Data Kitchen Is

Data Kitchen is a **retail intelligence platform** that transforms messy, multi-source product data into clean, retailer-ready catalogs. It is the operational backbone between a brand's internal product information and the specific format, validation, and delivery requirements of retail partners like Walmart, Target, Amazon, Home Depot, and Costco.

The platform is built around a six-step pipeline:

1. **Catalog Intake** — Import raw product data from any source
2. **Retailer Readiness** — Score products against retailer schemas
3. **Mapping Studio** — Map source fields to retailer-specific fields
4. **Validation & Exceptions** — Surface every blocker between a product and a live listing
5. **Delivery** — Generate retailer-ready payloads and push them
6. **Retail Feedback** — Decode retailer rejections and route them back into the pipeline

### What Data Kitchen Is NOT

- **Not a PIM.** Data Kitchen does not replace Product Information Management systems. It consumes their output and makes it retail-ready.
- **Not an MDM.** It does not attempt master data management across an enterprise. Its scope is the retail channel.
- **Not an ETL tool.** While it transforms data, its value is in the retail domain intelligence applied during transformation, not in the plumbing.
- **Not a marketplace listing tool.** It prepares data for delivery; it does not manage live listings, pricing, or inventory.

### Long-Term Vision

Data Kitchen will evolve into an AI-augmented retail intelligence platform where machine learning handles the repetitive, pattern-matchable work (field mapping, validation auto-heal, duplicate reconciliation) while humans retain approval authority over every change that ships to a retailer. The architecture is designed to support this evolution without requiring a rewrite — AI capabilities are additive layers, not replacement architectures.

---

## Guiding Principles

### 1. Retail Intelligence Platform

Every design decision is evaluated through the lens of retail product data. The canonical model, validation rules, and delivery formats are all shaped by the realities of retail partner APIs, not abstract data modeling ideals. This is not a general-purpose data platform.

### 2. Canonical Product Model

All product data flows through a single canonical representation. Source data is preserved verbatim, but the operational model — the one used for readiness scoring, validation, mapping, and delivery — is the canonical product. This provides a stable contract that the rest of the pipeline can depend on regardless of source format.

### 3. Retail-First Architecture

The system is designed for the realities of retail data: messy source files, inconsistent field naming, missing required fields, duplicate products across sources, and ever-changing retailer schemas. The architecture expects imperfect data and makes it visible rather than hiding it.

### 4. Auditability

Every change to a product is recorded. Source records are preserved immutably. Field-level provenance tracks where each canonical value originated. Change history records what changed, when, and why. This is not a compliance checkbox — it is a core requirement for a system where incorrect product data causes listing rejections, revenue loss, and retailer relationship damage.

### 5. Provenance Over Transformation

When data is normalized, both the original value and the normalized value are preserved. When a field is mapped from source to canonical, the mapping is recorded. When a duplicate is resolved, the resolution method is recorded. The system never silently transforms data.

### 6. Product Before AI

The architecture must deliver value with zero AI. AI capabilities are designed as acceleration layers that augment human workflows, never as foundations that the product depends on. If every AI feature were removed, the platform would still function — it would just require more manual effort.

### 7. Simplicity Over Premature Scalability

The system uses synchronous processing, a monolithic backend, and a single database. These choices are intentional. The current scale (thousands of products, dozens of imports per day) does not justify the operational complexity of message queues, microservices, or distributed systems. The architecture is designed to be decomposable when scale demands it, but it will not pay that complexity cost before it is earned.

---

## Accepted Decisions

### ADR-001: Canonical Product Model

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Product data arrives in wildly different formats from different source systems (PIMs, ERPs, spreadsheets, vendor feeds). Downstream steps (readiness, mapping, validation, delivery) need a stable structure to operate on.

**Decision:** Define a canonical product model with 8 typed core fields (sku, gtin, brand, product_name, short_description, long_description, category, manufacturer) plus 6 JSONB flexible fields (attributes, dimensions, packaging, compliance, digital_assets, identifiers).

**Alternatives considered:**
- **Fully flexible model (all JSONB):** Would make querying and validation harder. Core fields are well-known in retail and benefit from column-level indexing, constraints, and type safety.
- **Fully rigid model (all typed columns):** Would require schema migrations every time a new attribute is needed. Retail product data is inherently semi-structured.
- **Separate models per retailer:** Would create data duplication and make cross-retailer analytics impossible.

**Rationale:** The hybrid approach gives us column-level constraints and indexing for the fields that are universal in retail (every product has a name, most have a SKU) while preserving full flexibility for the long tail of category-specific attributes. This mirrors how retail APIs actually work — they have required core fields and optional extended attributes.

**Consequences:** The normalizer must decide which source fields map to core columns vs. which go into the attributes JSONB. The boundary is defined by the 8 core fields; everything else is an attribute. This is a simple, deterministic rule.

**Future considerations:** As retail-specific attributes prove universal (e.g., `country_of_origin`), they can be promoted to typed core columns via a migration. The attributes JSONB provides a staging ground for field promotion.

---

### ADR-002: Synchronous Import Pipeline

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The import flow involves parsing, normalizing, deduplicating, and persisting product data. This could be done synchronously (user waits for results) or asynchronously (background job with polling/webhooks).

**Decision:** Import processing is fully synchronous. The `POST /imports/:id/confirm` endpoint parses, normalizes, deduplicates, and persists all rows before returning results.

**Alternatives considered:**
- **Async with job queue:** Adds Redis/SQS dependency, requires polling or WebSocket infrastructure, complicates error reporting, and introduces eventual consistency that the UI must handle.
- **Hybrid (sync for small files, async for large):** Creates two code paths with different error handling, different UI flows, and different testing requirements.

**Rationale:** At current scale (max 10,000 rows per import, max 50MB file size), synchronous processing completes in seconds. The added complexity of async infrastructure has zero user benefit until files routinely exceed these limits. The import service is structured as a simple loop with per-row error handling, making it easy to reason about, test, and debug.

**Consequences:** Large files will block the HTTP connection. The `MAX_IMPORT_ROWS` configuration parameter bounds the worst case. When scale demands it, the import service can be extracted into a job worker without changing its internal logic — the service class is already decoupled from the HTTP layer.

**Future considerations:** When async processing is needed, add a job table, move `confirmImport` to a worker, and change the HTTP endpoint to return a job ID. The import service itself does not change.

---

### ADR-003: Separate Lifecycle Status and Data Quality Status

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Products need status tracking. A single status field conflates "where is this product in its lifecycle?" with "how good is the data?"

**Decision:** Two independent status fields:
- `lifecycle_status` — Tracks the product lifecycle: `draft` → `active` → `archived`
- `data_quality_status` — Tracks data completeness: `complete`, `missing_core_fields`, `parse_warning`, `needs_review`

**Alternatives considered:**
- **Single status field:** Leads to impossible states ("active but missing core fields") or compound statuses ("active_needs_review") that multiply combinatorially as new states are added.
- **Status + substatus:** Better than single, but the two concerns are genuinely orthogonal — a product can be active with complete data, active with missing fields, or draft with complete data. Substatus implies a hierarchy that does not exist.

**Rationale:** Lifecycle and data quality are independent dimensions. A product imported with complete data is `draft` + `complete`. When a human reviews and approves it, it becomes `active` + `complete`. If a subsequent import overwrites a field with bad data, it becomes `active` + `parse_warning`. Each dimension changes independently and for different reasons.

**Consequences:** The UI must present both statuses. Filtering and querying can operate on either dimension independently. The combined index `(catalog_id, data_quality_status)` supports the most common query pattern (show me all products with issues in this catalog).

---

### ADR-004: Source Record Preservation

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Product data arrives as CSV rows or JSON objects. After normalization, only the canonical fields are typically kept.

**Decision:** Every source row is preserved verbatim as a `source_record` with the raw payload stored as JSONB (`raw_payload_json`). Source records are immutable after creation.

**Alternatives considered:**
- **Discard source data after normalization:** Loses the ability to re-normalize, audit, or debug mapping issues.
- **Store raw files only:** Requires re-parsing to answer "what was the original value for this field?" — expensive and error-prone for large files.

**Rationale:** Source preservation enables re-normalization when mapping rules change, audit trails for data disputes, debugging when retailer rejections trace back to source data issues, and future AI training on source-to-canonical patterns. The storage cost is minimal relative to the value.

**Consequences:** The database grows with every import. Source records link to both their import batch and their canonical product, creating a many-to-one relationship (multiple source records from different imports can map to the same canonical product via deduplication).

---

### ADR-005: Field Provenance

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** When a canonical product has a brand of "The North Face", someone will eventually ask: "Where did that value come from? What was the original value? How was it normalized?"

**Decision:** Every field mapping from source to canonical creates a `field_provenance` record that captures: canonical field name, source field name, original value, normalized value, and normalization method.

**Alternatives considered:**
- **Store mapping rules only:** Answers "how was it mapped" but not "what was the original value in this specific import."
- **Reconstruct from source records:** Requires re-running the normalizer against the raw payload — possible but fragile if normalization rules change.

**Rationale:** Provenance is a first-class audit requirement. Retailers reject products for incorrect data. When a rejection arrives, the team needs to trace the canonical value back to its source system and source field to determine whether the issue is bad source data, a bad mapping rule, or a bad normalization. This must be instantaneous, not a forensic exercise.

**Consequences:** Provenance records grow proportionally with source records. Each source record creates one provenance record per mapped field (up to 8 core fields). The provenance table is append-only and indexed by product and source record.

---

### ADR-006: Product Change History

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** When a product's brand changes from "NorthFace" to "The North Face" after a re-import, there must be a record of what changed, when, and why.

**Decision:** A `canonical_product_history` table records every field-level change to a canonical product. Each row captures the field name (using dot-notation for nested paths), previous value, new value, the source record that triggered the change, and the actor.

**Alternatives considered:**
- **Database triggers:** Would capture changes automatically but are invisible in application code, harder to test, and cannot capture context like "which import caused this."
- **Event sourcing:** Full event sourcing would enable temporal queries but adds massive complexity for a use case that only needs "what changed" — not "rebuild the product at any point in time."
- **Diff at read time:** Compare source records chronologically to reconstruct history. Fragile, slow, and breaks when normalization rules change.

**Rationale:** Explicit history records are simple to write, simple to query, and carry context (actor, source record) that implicit approaches cannot. The history table is an append-only audit log, not a state reconstruction mechanism.

---

### ADR-007: TEXT Serialization for History Values

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** History records store `previous_value` and `new_value`. These values can be strings, numbers, booleans, nulls, or occasionally JSON objects.

**Decision:** Use `TEXT` columns with a documented serialization convention:
- Scalars are stored as their string representation (`"1.82"`, `"Vietnam"`, `"true"`)
- Null is stored as SQL NULL (not the string `"null"`)
- Arrays/objects use `JSON.stringify` only when leaf-level dot-notation is not practical

**Alternatives considered:**
- **JSONB columns:** Would enable querying within history values, but history values are never queried by content — they are only read for display. JSONB adds parsing overhead and prevents simple string comparison for change detection.
- **Separate typed columns per value type:** Over-engineering for an audit log.

**Rationale:** History is an audit log. Values are displayed to humans, not queried by machines. TEXT is the simplest representation that preserves all information. The documented serialization convention ensures consistency across all code paths that write history, backed by unit tests.

**Consequences:** Code that reads history values must understand the convention. In practice, this means displaying them as-is (they are already human-readable strings). The convention is documented in the Prisma schema model comment and in the `history.ts` module comment, with 13 unit tests validating the serialization behavior.

---

### ADR-008: Demo Mode Strategy

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The frontend must work without a backend for demos, Azure Static Web Apps deployment, and development of non-backend screens. But the UI must also support live data when a backend is available.

**Decision:** A `CatalogRepository` interface abstracts data access. Two implementations exist: `DemoCatalogRepository` (wraps seed data) and `ApiCatalogRepository` (calls the REST API). The resolution strategy:

1. If `VITE_FORCE_DEMO=true` → demo mode (build-time override)
2. If the health check at `/api/v1/health` returns a valid JSON response with `status: "ok"` → live mode
3. Otherwise → demo mode (graceful fallback)

**Alternatives considered:**
- **Feature flags:** Adds a dependency on a feature flag service for something that is determined by infrastructure availability.
- **Mock service worker:** Good for testing but inappropriate for production deployments that genuinely need to run without a backend.
- **Separate demo app:** Duplicates the entire frontend codebase.

**Rationale:** The repository pattern makes mode resolution invisible to page components. The health check validates response content (not just HTTP status) to avoid false positives from Vite's dev server SPA fallback, which returns 200 + HTML for any unmatched route. The `VITE_FORCE_DEMO` override ensures Azure Static Web Apps deployments always use demo mode without depending on health check behavior.

**Consequences:** Every page component that needs product data depends on the `CatalogRepository` interface. Demo mode is read-only (imports, provenance, source records, and history return empty arrays). A visible badge in the UI indicates the current mode.

---

### ADR-009: Live Mode with Zero Products

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** When the backend is healthy but the database has no products, the UI could show demo data or an empty state.

**Decision:** If the backend health check passes, the UI enters live mode even if the catalog has zero products. An empty state with an "Import Products" call-to-action is shown.

**Alternatives considered:**
- **Fall back to demo with zero products:** Creates a confusing transition when the first real product appears.
- **Block access until data exists:** Hostile UX; users need to see the interface to understand the import flow.

**Rationale:** Live mode is a deployment decision, not a data decision. If you connected a real backend, you want real behavior — including the "your catalog is empty, import something" experience. Mixing demo data into a live deployment would create confusion about which products are real.

---

### ADR-010: Canonical Product UUID as Current Identity

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Products need a stable identity that persists across re-imports, deduplication, and potential future merges. Options include a UUID primary key, a composite natural key (catalog + SKU), or a separate identity layer.

**Decision:** `canonical_product.id` (UUID, server-generated) is the stable product identity through Steps 1 through 5 of the roadmap.

**Alternatives considered:**
- **Composite key (catalog_id, sku):** SKUs can change, be null, or be reassigned. A mutable natural key as identity would cascade changes to every foreign key reference.
- **Separate product identity table now:** Adds indirection to every query, API, and UI component with zero behavioral benefit until AI reconciliation exists (see ADR-011).

**Rationale:** The UUID is immutable, globally unique, and decoupled from business data. The one-to-many relationship between canonical product and source records already models multi-source references. SKU and GTIN are identifiers used for duplicate detection, not identity.

**Consequences:** All foreign key references (source records, provenance, history) point to the canonical product UUID. This is the stable join key across the entire system.

---

### ADR-011: Deferred Product Identity Layer

| | |
|---|---|
| **Status** | Deferred |
| **Date** | 2026-08-02 |

**Context:** Multiple source systems may represent the same physical product differently. AI reconciliation in Step 6+ may need to merge canonical products that were initially created as separate rows.

**Decision:** A separate `product_identity` table is **not** introduced at this time. The migration path is documented in `server/prisma/ADR-001-product-identity.md`.

**Alternatives considered:**
- **Build the identity layer now:** Adds a table, a foreign key, and a join to every product query. Every API endpoint would need to expose `identityId` alongside `productId`. This is pure overhead until AI reconciliation exists.

**Rationale:** The cost of adding the identity layer later is well-understood and low (5-step migration documented in the ADR). The cost of adding it now is permanent complexity in every API, query, and UI component. The principle of "simplicity over premature scalability" applies.

**Migration path:** Create `product_identity` table → backfill one identity per product → add FK to `canonical_product` → populate → extend APIs. No existing data is lost. No APIs break.

---

### ADR-012: PostgreSQL

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The system needs a relational database with JSONB support for flexible fields, partial unique indexes for conditional uniqueness constraints, and mature tooling.

**Decision:** PostgreSQL 16 is the database.

**Alternatives considered:**
- **SQLite:** Insufficient for production workloads, no JSONB, no partial indexes.
- **MySQL:** JSONB support is inferior to PostgreSQL. Partial unique indexes are not supported.
- **MongoDB:** Would eliminate the need for JSONB columns but lose relational integrity, transactional guarantees across related tables, and the ability to express constraints like "SKU must be unique within a catalog, but only when not null."

**Rationale:** PostgreSQL uniquely supports the partial unique index `WHERE sku IS NOT NULL` that enforces SKU uniqueness within a catalog while allowing null SKUs. This cannot be expressed in Prisma's schema language, requiring a custom SQL migration — an acceptable tradeoff for a constraint that prevents a class of data integrity bugs. PostgreSQL's JSONB support, transactional guarantees, and ecosystem maturity make it the natural choice.

**Consequences:** Prisma is used as the ORM with custom SQL migrations for features Prisma cannot express. The partial unique index surfaces as a Prisma P2002 error on duplicate SKU insertion, which the import service handles.

---

### ADR-013: Azure Blob Storage

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Imported files must be stored durably so they can be re-parsed during the confirm step and preserved for audit purposes.

**Decision:** Azure Blob Storage is the primary storage provider. A `StorageProvider` interface abstracts the storage layer, with implementations for Azure Blob and local filesystem.

**Alternatives considered:**
- **Store files in the database:** Bloats the database with binary data. PostgreSQL BYTEA is not designed for file storage.
- **S3:** Would work equally well but adds a cross-cloud dependency when the rest of the infrastructure is Azure.
- **Local filesystem only:** Not durable across deployments, not scalable, not suitable for production.

**Rationale:** Azure Blob Storage aligns with the existing Azure infrastructure (Azure Static Web Apps for frontend, Azure App Service for backend). The storage interface pattern (`StorageProvider`) allows local filesystem storage during development and testing without requiring Azure credentials. The factory pattern (`createStorageProvider`) selects the implementation based on the `STORAGE_PROVIDER` environment variable.

---

### ADR-014: React + Fastify Monolith

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The system needs a frontend and a backend. They could be a single application, a monorepo with shared code, or fully separate repositories.

**Decision:** A monorepo with independent packages: React 19 + Vite 8 at the root, Fastify 5 in `server/`. Each has its own `package.json`, `tsconfig.json`, and deployment pipeline. No shared code between frontend and backend.

**Alternatives considered:**
- **Next.js (full-stack):** Would couple frontend routing to backend API design, limit deployment flexibility, and add framework complexity that is not needed.
- **Separate repositories:** Makes it harder to maintain consistency between API contracts and frontend types.
- **NestJS:** Adds decorators, modules, and dependency injection framework overhead. Fastify is sufficient and more transparent.

**Rationale:** Fastify was chosen for its performance, TypeScript support, and plugin architecture. The monorepo structure keeps API contracts and frontend types in the same commit history. Independent deployment pipelines allow the frontend to ship to Azure Static Web Apps and the backend to Azure App Service without coupling their release cycles.

**Consequences:** The Vite dev server proxies `/api/v1` to the Fastify backend during development. In production, the Azure Static Web Apps routing config excludes `/api/*` from SPA fallback.

---

### ADR-015: Repository Pattern for Frontend Data Access

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The frontend needs to fetch product data from either the REST API (live mode) or seed data (demo mode) using the same page components.

**Decision:** A `CatalogRepository` TypeScript interface defines the data access contract. `DemoCatalogRepository` and `ApiCatalogRepository` implement it. A factory function (`getCatalogRepository`) resolves the appropriate implementation at startup and caches it.

**Alternatives considered:**
- **Conditional fetching in components:** Scatters mode logic across every component. Each component would need `if (demo) { ... } else { ... }` branches.
- **GraphQL with mock resolvers:** Adds a GraphQL layer that has no benefit when the API is simple REST.
- **React Context with provider swap:** Would work but adds indirection. The factory function is simpler.

**Rationale:** The repository pattern isolates mode resolution to a single point. Page components call `repo.getProducts()` without knowing or caring whether the data comes from seed data or a REST API. This also makes it trivial to add a third implementation (e.g., for integration testing).

---

### ADR-016: Avoiding Microservices

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The system has distinct functional areas: parsing, normalization, deduplication, storage, and API serving. These could be deployed as separate services or as a single application.

**Decision:** All backend logic runs in a single Fastify process. Functional boundaries are expressed as service classes and modules, not deployment units.

**Alternatives considered:**
- **Separate parser service:** Adds network latency, deployment complexity, and a serialization boundary for no benefit at current scale.
- **Separate import worker:** Would enable async processing but is not needed while imports are synchronous (see ADR-002).

**Rationale:** A single process eliminates network latency between services, simplifies deployment, simplifies local development, and simplifies debugging. The service classes (`ImportService`, parsers, normalizer, duplicate resolver) are already cleanly separated — they communicate through function calls, not network requests. If a functional boundary needs to become a deployment boundary in the future, the existing module structure makes extraction straightforward.

**Consequences:** All services share a single PrismaClient connection pool and a single error handler. The process must handle all concerns: file upload, parsing, normalization, deduplication, persistence, and API serving.

---

### ADR-017: Duplicate Detection Strategy

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** When importing a file that contains products already in the catalog, the system must decide: create a new product or update the existing one?

**Decision:** Duplicate detection uses a two-tier matching strategy within the same catalog:
1. **SKU match first** — If the incoming row has a SKU and a product with that SKU exists in the catalog, it is a duplicate.
2. **GTIN match second** — If no SKU match, and the incoming row has a GTIN and a product with that GTIN exists, it is a duplicate.

On match, non-empty incoming fields overwrite existing fields. Empty/null incoming fields are ignored (they do not erase existing data). All changes are recorded in history.

**Alternatives considered:**
- **Always create new products:** Forces manual deduplication later. Quickly fills the catalog with duplicates.
- **Fuzzy matching on product name:** Error-prone, slow, and would require confidence thresholds that are hard to tune without AI.
- **Cross-catalog matching:** Would create data ownership ambiguity. Catalogs are independent workspaces.

**Rationale:** SKU and GTIN are the two most reliable product identifiers in retail. SKU is preferred because it is the identifier most commonly used in internal systems. GTIN is the fallback because it is the most standardized external identifier. The "non-empty only" overwrite strategy prevents imports with sparse data from erasing existing rich data. A partial unique index on `(catalog_id, sku) WHERE sku IS NOT NULL` enforces this at the database level.

---

### ADR-018: Auto-Created Default Catalog

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The UI needs a catalog to operate on. Users should not be forced to create a catalog before they can start importing.

**Decision:** When `GET /catalogs` is called and no catalogs exist for the organization, a "Default Catalog" is automatically created and returned.

**Alternatives considered:**
- **Require explicit catalog creation:** Adds a mandatory step before the first import. Poor first-run experience.
- **Seed a default catalog in the migration:** Couples database schema to application logic. Does not work cleanly across environments.

**Rationale:** Auto-creation is a one-time convenience that eliminates a step in the first-run experience. The catalog model is simple enough that creating a default is safe. Users can create additional catalogs via the API when needed.

---

### ADR-026: One Authoritative Import Matcher

| | |
|---|---|
| **Status** | Accepted (supersedes the per-row implementation of ADR-017) |
| **Date** | 2026-08-08 |

**Context:** "Which existing product does this row describe?" was answered in two places. `findDuplicate` asked it one row at a time during commit; `projectImportImpact` asked it once per file, batched, to warn the operator at the confirm screen which products an import would overwrite. Two implementations of one rule is one too many, and they had already drifted: the projection compared raw GTIN text against stored GTIN-14, so a 12-digit GTIN previewed as a create and committed as an update.

**Decision:** `resolveImportMatches` is the single definition of the matching rule. Both the preview and the commit pipeline route through it. `findDuplicate` was deleted rather than left in place as a second, dead definition. The matching rule itself is unchanged (ADR-017): SKU first, GTIN only as a fallback, scoped to one catalog — and now to the organization as well, since both callers already know it.

**Alternatives considered:**
- **Keep both and add tests asserting they agree:** Tests would document the duplication rather than remove it, and would need extending every time either side changed.
- **Have the preview call the commit path in a rolled-back transaction:** Exact by construction, but it would make opening the confirm screen as expensive as running the import.

**Rationale:** The preview makes a promise to the operator — "this many creates, this many updates, and here is what you are about to overwrite" — and the commit is what actually happens. Nothing in the type system forces those to agree, so the only durable guarantee is that there is one implementation. Equivalence tests drive both routes to the matcher over shared fixtures and fail if either is changed alone.

A consequence worth stating: in-file duplicate behaviour used to be *emergent*. A product created by row 3 was in the database by the time row 40 was matched, so row 40 updated it. A batched matcher has no such luck and reproduces it deliberately, registering pending creates in its index as it resolves. That property is what makes chunked commit (ADR-027) safe.

---

### ADR-027: Chunk-Granular Import Transactions

| | |
|---|---|
| **Status** | Accepted (supersedes the per-row transaction boundary of ADR-002) |
| **Date** | 2026-08-08 |

**Context:** Phase 1.0.2 Increment A made imports durable but left the commit shape alone: one transaction per row, roughly twelve statements each. Measurement put throughput at 3.4 rows/sec at both 100 and 500 rows — flat, which is what cost-scales-with-rows looks like. A 10,000-row import extrapolated to 49 minutes.

**Decision:** Commit one *chunk* per transaction rather than one row. A chunk is planned entirely in memory — one batched match query and one read of the products it will update — and written as bulk inserts inside a single transaction whose last statement advances the resume pointer. `IMPORT_CHUNK_SIZE` (default 100) was already the checkpoint interval and is now the transaction boundary.

**Alternatives considered:**
- **One transaction for the whole import:** Simplest to reason about, but it holds locks for the length of the run, makes partial progress impossible, and destroys the resume semantics Increment A was built to provide.
- **Keep per-row transactions and only batch the inserts within them:** Removes the provenance loop but leaves the per-row match query and the per-row transaction overhead, which together were most of the cost.
- **`INSERT ... ON CONFLICT` upserts against `idx_product_sku_catalog`:** Attractive on statement count, but it cannot express "only overwrite non-empty incoming fields" (ADR-017) without either a large generated expression per column or a semantic change. Rejected as complexity bought with correctness.

**Rationale:** The durability invariant is unchanged in kind — `progress_rows` is still the highest fully committed source row, because it still commits with the work it counts. Only the size of the unit changed, and a chunk that fails rolls back its writes and its progress together.

Two properties were preserved deliberately rather than by luck:

- **Row-level fault isolation.** Per-row transactions meant one unimportable row cost one row. A chunk whose bulk commit fails is therefore replayed one row at a time. The replay doubles as proof that the failed bulk attempt left nothing behind, since `uq_source_record_batch_row` would reject it otherwise.
- **Bounded lock duration.** Roughly 290 ms per 100-row chunk at 10,000 rows, versus a whole-import transaction of 33 seconds.

Canonical UPDATE statements remain one per changed product. The update shape is per-row — which columns appear depends on which fields the row carried — so batching them means either a synthetic `VALUES` join or overwriting columns the row never mentioned. This is the one path where work still scales with rows, and it is a correctness choice, not an oversight.

Measured result: 500 rows from 146 s to 2.0 s, 10,000 rows to 33 s, statements per row from 12.0 to 0.08.

---

### ADR-028: An Unchanged Row Writes No Product

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-08 |

**Context:** Re-uploading the same export is normal operator behaviour. Every matched row previously issued an UPDATE, because `data_quality_status` and `updated_by` were set unconditionally — so re-importing an unchanged 10,000-row file rewrote 10,000 products to no effect.

**Decision:** When a matched product already holds every value the row carries — no field differs, no new attribute, the same data-quality status, the same actor — the row produces no canonical write at all. It still produces its source record and its provenance.

**Alternatives considered:**
- **Keep writing unconditionally:** Honest about "this row was applied", but it costs a write per row and fills `updated_at` with events that changed nothing.
- **Write only `updated_at`:** All of the cost, none of the information.

**Rationale:** The source record is the record that the row was seen; the canonical product is the record of what is true. If nothing about the product changed, there is nothing to write, and history already agrees — an unchanged field never produced a history entry.

The visible consequence is that `updated_at` no longer moves on an unchanged re-import. That is stated in the operator guide, because it is a behaviour change an operator could otherwise notice and mistrust. `/imports/:id/results` still counts such rows as updates, which is what the operator asked for and what happened.

---

## Deferred Decisions

The following architectural decisions have been intentionally postponed. Each includes the rationale for deferral and a sketch of the expected approach.

### AI Agents

**Deferred until:** Step 6+

AI capabilities (auto-mapping, validation auto-heal, duplicate reconciliation) are designed as augmentation layers, not core architecture. The current system provides the data foundation (source records, provenance, history) that AI models will need for training and evaluation. Introducing AI before the data pipeline is proven would optimize the wrong thing.

### Product Identity Layer

**Deferred until:** AI reconciliation requires cross-product grouping (Step 6+). See ADR-011 for the full decision and migration path.

### Retail Intelligence Library

**Deferred until:** Steps 2-4 implementation

A structured library of retailer schemas, field requirements, validation rules, and format specifications. The current prototype screens (Readiness, Mapping, Validation) use seed data to demonstrate the concept. The library will be built as a first-class data model when these screens are converted from prototype to production.

### Retailer Readiness Engine

**Deferred until:** Step 2 implementation

The readiness scoring engine that evaluates products against retailer schema requirements. This depends on the Retail Intelligence Library and the canonical product model established in Step 1.

### Async Processing

**Deferred until:** Import volumes exceed synchronous processing limits. See ADR-002 for the migration path.

### Event-Driven Architecture

**Deferred until:** Multiple consumers need to react to product changes.

The current system writes history records synchronously during import. An event-driven architecture would emit domain events (`ProductCreated`, `ProductUpdated`, `FieldChanged`) that multiple consumers could subscribe to. This is not needed until there are multiple consumers — e.g., a readiness score recalculation that triggers when a product field changes, or a webhook that notifies external systems of product updates.

### Authentication and Authorization

**Status:** Implemented — provider-neutral auth with development mode, hardened for internal deployment.

Authentication uses a provider-neutral `AuthProvider` interface. In development, `DevAuthProvider` validates the Bearer token against the configured `DEV_AUTH_TOKEN` environment variable — incorrect, empty, or missing tokens are rejected with 401. In production, a JWT-validating provider (vendor TBD) will be configured via `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URI`.

The `AutoTenantResolver` resolves the authenticated user to a `TenantContext` (userId, organizationId, role). Single-org users are auto-resolved; multi-org users must send `X-Organization-Id` (validated against active memberships). Authorization uses explicit role-to-permission mapping with three roles (`organization_admin`, `operator`, `viewer`) and five permissions.

Operational audit logging records auth failures, catalog/import operations, org settings changes, and authorization denials in an append-only `AuditLog` table. Request correlation via `X-Request-Id` propagates through requests, responses, and structured logs. See `MULTI_TENANCY.md` for the full design.

---

## Non-Goals

These are capabilities Data Kitchen is explicitly not trying to build. They are documented here to prevent scope creep and to clarify the product's boundaries.

1. **PIM replacement.** Data Kitchen consumes PIM output. It does not manage product content authoring, digital asset management, or content syndication workflows.

2. **Inventory management.** Product quantities, warehouse locations, fulfillment logistics, and stock-level tracking are out of scope.

3. **Pricing engine.** Competitive pricing, promotional pricing, margin calculations, and price optimization are out of scope.

4. **Marketplace listing management.** Managing live listings, responding to buyer questions, handling returns, or monitoring listing health on marketplaces is out of scope.

5. **General-purpose ETL.** Data Kitchen transforms product data for retail channels. It is not a Fivetran, Airbyte, or dbt replacement.

6. **Real-time data streaming.** The system processes batch imports. Real-time CDC from source systems, streaming ingestion, or live data pipelines are not planned.

7. **Multi-language content management.** Locale-specific product content, translation workflows, and internationalization of product data are out of scope for the initial architecture.

---

## Decision Timeline

| Date | Decision | Status | ADR |
|---|---|---|---|
| 2026-08-02 | Canonical Product Model with hybrid typed + JSONB fields | Accepted | ADR-001 |
| 2026-08-02 | Synchronous import pipeline (defer async) | Accepted | ADR-002 |
| 2026-08-02 | Separate lifecycle_status and data_quality_status | Accepted | ADR-003 |
| 2026-08-02 | Immutable source record preservation | Accepted | ADR-004 |
| 2026-08-02 | Field-level provenance tracking | Accepted | ADR-005 |
| 2026-08-02 | Product change history with TEXT serialization | Accepted | ADR-006, ADR-007 |
| 2026-08-02 | Demo/Live mode via repository pattern | Accepted | ADR-008 |
| 2026-08-02 | Live mode with zero products (no demo fallback) | Accepted | ADR-009 |
| 2026-08-02 | UUID as product identity, defer identity layer | Accepted/Deferred | ADR-010, ADR-011 |
| 2026-08-02 | PostgreSQL with Prisma + custom SQL migrations | Accepted | ADR-012 |
| 2026-08-02 | Azure Blob Storage with provider abstraction | Accepted | ADR-013 |
| 2026-08-02 | React + Fastify monorepo, no shared code | Accepted | ADR-014 |
| 2026-08-02 | Frontend repository pattern for data access | Accepted | ADR-015 |
| 2026-08-02 | Single-process monolith, defer microservices | Accepted | ADR-016 |
| 2026-08-02 | SKU-first, GTIN-second duplicate detection | Accepted | ADR-017 |
| 2026-08-02 | Auto-created default catalog | Accepted | ADR-018 |
| 2026-08-02 | Provider-neutral auth with DevAuthProvider, AutoTenantResolver | Accepted | ADR-019, ADR-020 |
| 2026-08-02 | Interim internal-test auth mode with DEV_AUTH_TOKEN | Accepted | ADR-021 |
| 2026-08-02 | Role-based authorization with explicit permission mapping | Accepted | ADR-022 |
| 2026-08-02 | Organization configuration — hybrid typed + JSONB | Accepted | ADR-023 |
| 2026-08-02 | PostgreSQL RLS deferred as defense-in-depth | Deferred | ADR-024 |
| 2026-08-02 | Tenant-isolated blob storage with prefix enforcement | Accepted | ADR-025 |
| 2026-08-02 | Deferred: AI agents, product identity, async, events | Deferred | — |
| 2026-08-08 | One authoritative import matcher, shared by preview and commit | Accepted | ADR-026 |
| 2026-08-08 | Chunk-granular import transactions (supersedes per-row) | Accepted | ADR-027 |
| 2026-08-08 | An unchanged row writes no canonical product | Accepted | ADR-028 |
