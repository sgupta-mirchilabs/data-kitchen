# Data Kitchen System Overview

> **Last updated:** 2026-08-02
> **Scope:** Step 1 — Real Catalog Intake, Canonical Product Model, and Persistence
> **Reading time:** ~30 minutes

---

## Executive Summary

Data Kitchen is a retail intelligence platform that transforms messy, multi-source product data into clean, retailer-ready catalogs. It is built as a six-step pipeline: Catalog Intake, Retailer Readiness, Mapping Studio, Validation & Exceptions, Delivery, and Retail Feedback.

**Step 1** (this release) implements the foundational data layer: real file imports (CSV/JSON), a canonical product model with typed core fields and flexible JSONB attributes, full source record preservation, field-level provenance tracking, and product change history. The frontend operates in demo mode (seed data) or live mode (REST API) depending on backend availability.

The system is a monorepo with two independently deployed packages: a React 19 SPA (Azure Static Web Apps) and a Fastify 5 API server (Azure App Service) backed by PostgreSQL 16 and Azure Blob Storage.

---

## Product Architecture

The complete Data Kitchen pipeline, from source data to retail delivery:

```mermaid
flowchart TB
    subgraph Sources["Source Systems"]
        CSV["CSV / TSV Files"]
        JSON["JSON Files"]
        API_IN["Future: API Feeds"]
    end

    subgraph Step1["Step 1: Catalog Intake ✅"]
        UPLOAD["Upload & Parse"]
        PREVIEW["Preview & Map Fields"]
        NORMALIZE["Normalize & Deduplicate"]
        PERSIST["Persist to Canonical Model"]
    end

    subgraph Step2["Step 2: Retailer Readiness"]
        SCORE["Score Against Retailer Schemas"]
    end

    subgraph Step3["Step 3: Mapping Studio"]
        MAP["Map Canonical → Retailer Fields"]
    end

    subgraph Step4["Step 4: Validation & Exceptions"]
        VALIDATE["Validate & Surface Blockers"]
    end

    subgraph Step5["Step 5: Delivery"]
        DELIVER["Generate & Push Payloads"]
    end

    subgraph Step6["Step 6: Retail Feedback"]
        FEEDBACK["Decode Rejections & Route Back"]
    end

    subgraph Future["Future"]
        AI["AI Agents & Auto-Heal"]
    end

    CSV --> UPLOAD
    JSON --> UPLOAD
    API_IN -.-> UPLOAD
    UPLOAD --> PREVIEW
    PREVIEW --> NORMALIZE
    NORMALIZE --> PERSIST
    PERSIST --> SCORE
    SCORE --> MAP
    MAP --> VALIDATE
    VALIDATE --> DELIVER
    DELIVER --> FEEDBACK
    FEEDBACK -.-> VALIDATE
    AI -.-> MAP
    AI -.-> VALIDATE
    AI -.-> FEEDBACK

    style Step1 fill:#1a2e1a,stroke:#22c55e,color:#fff
    style Step2 fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Step3 fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Step4 fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Step5 fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Step6 fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Future fill:#2e1a1a,stroke:#ef5b4e,color:#fff
```

**Green** = implemented. **Blue** = prototype UI with seed data. **Red** = future.

---

## High-Level Architecture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        SPA["React 19 SPA"]
    end

    subgraph Azure_SWA["Azure Static Web Apps"]
        CDN["CDN + SPA Hosting"]
    end

    subgraph Azure_App["Azure App Service"]
        FASTIFY["Fastify 5 API"]
    end

    subgraph Azure_Storage["Azure"]
        BLOB["Blob Storage"]
        PG["PostgreSQL 16"]
    end

    SPA --> CDN
    CDN -->|"/api/v1/*"| FASTIFY
    FASTIFY --> PG
    FASTIFY --> BLOB

    style Client fill:#0a0a0b,stroke:#ef5b4e,color:#fff
    style Azure_SWA fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Azure_App fill:#1a1a2e,stroke:#3b82f6,color:#fff
    style Azure_Storage fill:#1a2e1a,stroke:#22c55e,color:#fff
```

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 19, Vite 8, React Router 7 | SPA with 6-step pipeline UI |
| Backend | Fastify 5, TypeScript 5.7 | REST API, import pipeline |
| ORM | Prisma 6 | Database access, schema management |
| Database | PostgreSQL 16 | Relational + JSONB storage |
| File Storage | Azure Blob / Local FS | Imported file preservation |
| Frontend Hosting | Azure Static Web Apps | CDN, SPA routing |
| Backend Hosting | Azure App Service | Node.js runtime |

---

## Frontend Architecture

### Route Structure

The frontend is a single-page application with six routes, one per pipeline step:

| Route | Page | Status | Data Source |
|---|---|---|---|
| `/intake` | Catalog Workspace | **Live** | CatalogRepository (API or demo) |
| `/readiness` | Retailer Readiness | Prototype | Seed data |
| `/mapping` | Mapping Studio | Prototype | Seed data |
| `/validation` | Validation & Exceptions | Prototype | Seed data |
| `/delivery` | Delivery | Prototype | Seed data |
| `/feedback` | Retail Feedback | Prototype | Seed data |

### Component Architecture

```mermaid
flowchart TB
    subgraph Shell["App Shell"]
        SIDEBAR["Sidebar Navigation"]
        MAIN["Main Content Area"]
    end

    subgraph CatalogWorkspace["Catalog Workspace (IntakePage)"]
        STATS["Stats Bar"]
        FILTERS["Search & Filter"]
        TABLE["Product Table"]
        DETAIL["Product Detail Panel"]
        TABS["4 Tabs: Canonical | Source | Provenance | History"]
    end

    subgraph ImportWizard["Import Wizard"]
        DROP["FileDropZone"]
        PREV["ImportPreview"]
        FMAP["FieldMapper"]
        PROG["ImportProgress"]
        RES["ImportResults"]
    end

    subgraph DataLayer["Data Layer"]
        REPO["CatalogRepository Interface"]
        DEMO["DemoCatalogRepository"]
        APIREPO["ApiCatalogRepository"]
        APICLIENT["api-client"]
        SEED["seed-data"]
    end

    MAIN --> CatalogWorkspace
    CatalogWorkspace --> ImportWizard
    DETAIL --> TABS
    CatalogWorkspace --> REPO
    ImportWizard --> APICLIENT
    REPO --> DEMO
    REPO --> APIREPO
    DEMO --> SEED
    APIREPO --> APICLIENT

    style Shell fill:#1c1c1f,stroke:#333,color:#fff
    style CatalogWorkspace fill:#1a2e1a,stroke:#22c55e,color:#fff
    style ImportWizard fill:#1a2e1a,stroke:#22c55e,color:#fff
    style DataLayer fill:#1a1a2e,stroke:#3b82f6,color:#fff
```

### Demo/Live Mode Resolution

The frontend automatically selects its data source at startup:

```mermaid
flowchart TD
    START["App Loads"] --> CHECK_ENV{"VITE_FORCE_DEMO\n= true?"}
    CHECK_ENV -->|Yes| DEMO["DemoCatalogRepository\n(seed data)"]
    CHECK_ENV -->|No| HEALTH["GET /api/v1/health\n(3s timeout)"]
    HEALTH -->|JSON with status: ok| LIVE["ApiCatalogRepository\n(REST API)"]
    HEALTH -->|Timeout / non-JSON / error| DEMO
    DEMO --> BADGE_D["UI shows DEMO badge"]
    LIVE --> BADGE_L["UI shows LIVE badge"]

    style DEMO fill:#2e2e1a,stroke:#f59e0b,color:#fff
    style LIVE fill:#1a2e1a,stroke:#22c55e,color:#fff
```

The health check validates response content type (`application/json`) and body structure (`status: "ok"`) to avoid false positives from the Vite dev server's SPA fallback, which returns 200 + HTML for unmatched routes.

---

## Backend Architecture

### Service Structure

The backend is a single Fastify process organized into layers:

```
server/
├── src/
│   ├── index.ts                    # Bootstrap, DI wiring, lifecycle
│   ├── config.ts                   # Environment-driven configuration, fail-fast validation
│   ├── types.ts                    # Fastify type augmentation
│   ├── errors/
│   │   └── api-errors.ts           # Structured error hierarchy
│   ├── auth/
│   │   ├── types.ts                # AuthProvider, TenantContext, AuthenticatedUser
│   │   ├── dev-auth-provider.ts    # Development auth (DEV_AUTH_TOKEN validation)
│   │   ├── auto-tenant-resolver.ts # Auto/explicit org resolution
│   │   ├── middleware.ts           # onRequest auth hook, request correlation
│   │   └── permissions.ts          # Role-to-permission mapping
│   ├── storage/
│   │   ├── storage.interface.ts    # StorageProvider contract
│   │   ├── azure-blob.storage.ts   # Azure Blob implementation
│   │   ├── local-fs.storage.ts     # Local filesystem implementation
│   │   ├── storage.factory.ts      # Provider selection factory
│   │   └── tenant-scoped.storage.ts# Tenant-prefixed storage wrapper
│   ├── services/
│   │   ├── import.service.ts       # Import orchestration
│   │   ├── audit.service.ts        # Append-only audit logging
│   │   ├── normalizer.ts           # Field mapping & normalization
│   │   ├── duplicate-resolver.ts   # SKU/GTIN duplicate detection
│   │   ├── history.ts              # Change tracking & serialization
│   │   └── parser/
│   │       ├── parser.types.ts     # Shared parser types
│   │       ├── csv-parser.ts       # CSV/TSV parsing
│   │       └── json-parser.ts      # JSON parsing
│   └── routes/
│       ├── health.routes.ts        # GET /health (public)
│       ├── user.routes.ts          # GET /me, GET /me/organizations (auth-only)
│       ├── catalog.routes.ts       # Catalog CRUD (tenant-scoped)
│       ├── import.routes.ts        # Import lifecycle (tenant-scoped)
│       ├── product.routes.ts       # Product queries (tenant-scoped)
│       └── organization.routes.ts  # Org settings, members, audit log (tenant-scoped)
├── prisma/
│   ├── schema.prisma               # Data model (12 tables)
│   ├── migrations/                 # 3 SQL migrations
│   ├── seed.ts                     # Dev seed (production-safe guards)
│   └── ADR-001-product-identity.md # Deferred identity decision
└── test/
    ├── fixtures/                   # Sample CSV/JSON files
    ├── unit/                       # 90 unit tests
    └── integration/                # 23 tenant-isolation tests (requires PostgreSQL)
```

### Backend Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Fastify
    participant ErrorHandler
    participant Route
    participant Service
    participant Prisma
    participant Storage

    Client->>Fastify: HTTP Request
    Fastify->>Fastify: CORS check
    Fastify->>Fastify: Multipart parsing (if upload)
    Fastify->>Route: Route match

    alt Success path
        Route->>Service: Business logic
        Service->>Prisma: Database queries
        Service->>Storage: File operations
        Service-->>Route: Result
        Route-->>Client: { data: T, meta?: {...} }
    else AppError thrown
        Service-->>ErrorHandler: AppError (400/404/413/422/500)
        ErrorHandler-->>Client: { error: { code, message, details? } }
    else Unexpected error
        Service-->>ErrorHandler: Unknown error
        ErrorHandler-->>Client: { error: { code: "INTERNAL_ERROR" } }
    end
```

### Dependency Injection

Dependencies are wired at startup in `index.ts` and attached to the Fastify instance via `decorate()`:

| Dependency | Access Pattern | Lifecycle |
|---|---|---|
| PrismaClient | `fastify.prisma` | Created at startup, connected before listen, disconnected on shutdown |
| StorageProvider | `fastify.storage` | Created at startup via factory (Azure or local based on env), wrapped with `TenantScopedStorage` per request |
| AppConfig | `fastify.config` | Created at startup from environment variables, immutable |
| AuthProvider | `fastify.authProvider` | Created at startup (`DevAuthProvider` or JWT provider based on `AUTH_MODE`) |
| TenantResolver | `fastify.tenantResolver` | Created at startup (`AutoTenantResolver`), resolves `TenantContext` per request |

Routes access these via the Fastify instance. Services receive them as constructor parameters.

---

## Repository Structure

```
Data-Kitchen/
├── src/                            # Frontend source (React)
│   ├── App.tsx                     # Route definitions
│   ├── main.tsx                    # Entry point (BrowserRouter)
│   ├── index.css                   # Design system (CSS variables, dark theme)
│   ├── pages/                      # One page per pipeline step
│   ├── components/
│   │   ├── shell/                  # AppShell, Sidebar
│   │   └── catalog/                # Import wizard, product detail
│   └── lib/
│       ├── api-client.ts           # HTTP client for backend
│       ├── catalog-repository.ts   # Repository pattern (demo/live)
│       ├── seed-data.ts            # Demo mode data
│       └── utils.ts                # Classname helper
├── server/                         # Backend source (Fastify)
│   └── (see Backend Architecture above)
├── public/
│   └── staticwebapp.config.json    # Azure SWA routing
├── docs/architecture/              # Architecture documents
├── .github/workflows/              # CI/CD pipelines
├── package.json                    # Frontend dependencies
├── vite.config.ts                  # Vite + dev proxy
└── tsconfig.json                   # Frontend TypeScript config
```

The frontend and backend are **independent packages** — separate `package.json`, separate `tsconfig.json`, separate dependency trees. No shared code between them. The monorepo structure keeps API contracts and frontend types in the same commit history.

---

## Import Flow

The import pipeline is the core of Step 1. It is a two-phase, human-in-the-loop process:

### Phase 1: Upload & Preview

```mermaid
sequenceDiagram
    participant User
    participant UI as ImportWizard
    participant API as POST /catalogs/:id/imports
    participant Store as StorageProvider
    participant Parser as CSV/JSON Parser

    User->>UI: Drop file (.csv or .json)
    UI->>API: multipart/form-data upload
    API->>Store: Store raw file (org/catalog/timestamp-filename)
    API->>Parser: Parse file content
    Parser-->>API: Headers, rows, warnings, metadata
    API->>API: Auto-suggest field mappings via alias table
    API-->>UI: Preview (headers, 20 sample rows, warnings, suggested mappings)
    UI->>User: Show preview table, warnings, suggested mappings
    User->>UI: Review/adjust mappings, click "Start Import"
```

### Phase 2: Confirm & Import

```mermaid
sequenceDiagram
    participant UI as ImportWizard
    participant API as POST /imports/:id/confirm
    participant Store as StorageProvider
    participant Norm as Normalizer
    participant Dedup as DuplicateResolver
    participant DB as PostgreSQL

    UI->>API: { fieldMappings: {...} }
    API->>Store: Re-download raw file
    API->>API: Re-parse file

    loop For each row
        API->>Norm: Normalize row using field mappings
        Norm-->>API: Canonical fields + provenance entries
        API->>API: Compute data quality status
        API->>Dedup: Check for duplicate (SKU first, then GTIN)

        alt New product
            API->>DB: BEGIN TRANSACTION
            API->>DB: INSERT canonical_product
            API->>DB: INSERT source_record (raw payload)
            API->>DB: INSERT field_provenance (per mapped field)
            API->>DB: COMMIT
        else Duplicate found
            API->>DB: BEGIN TRANSACTION
            API->>DB: UPDATE canonical_product (non-null fields only)
            API->>DB: INSERT source_record
            API->>DB: INSERT field_provenance
            API->>DB: INSERT canonical_product_history (per changed field)
            API->>DB: COMMIT
        else Row error
            API->>DB: INSERT source_record (parse_status: error)
        end
    end

    API->>DB: UPDATE import_batch (final counts, status)
    API-->>UI: Results (created, updated, warnings, errors)
```

Key design properties:
- **Synchronous** — the HTTP request blocks until all rows are processed
- **Per-row transactions** — a failed row does not abort the batch
- **Non-destructive updates** — null/empty incoming values never overwrite existing data
- **Full provenance** — every field mapping creates a provenance record
- **History on update** — every changed field creates a history record

---

## Data Flow

### From Source to Canonical Product

```mermaid
flowchart LR
    subgraph Source["Raw Source Data"]
        RAW["CSV row or JSON object"]
    end

    subgraph Normalization
        ALIAS["Header Alias Matching"]
        GTIN_NORM["GTIN Padding (→ GTIN-14)"]
        TRIM["Whitespace Trimming"]
        UNMAPPED["Unmapped Fields → attributes JSONB"]
    end

    subgraph Canonical["Canonical Product"]
        CORE["8 Core Fields\nsku, gtin, brand, product_name,\ncategory, manufacturer,\nshort/long_description"]
        FLEX["6 JSONB Fields\nattributes, dimensions,\npackaging, compliance,\ndigital_assets, identifiers"]
    end

    subgraph Audit["Audit Trail"]
        SR["Source Record\n(raw payload, immutable)"]
        FP["Field Provenance\n(original → normalized, per field)"]
        CH["Change History\n(previous → new, per field, per update)"]
    end

    RAW --> ALIAS
    ALIAS --> GTIN_NORM
    GTIN_NORM --> TRIM
    TRIM --> CORE
    TRIM --> UNMAPPED
    UNMAPPED --> FLEX
    RAW --> SR
    ALIAS --> FP
    CORE --> CH

    style Source fill:#2e1a1a,stroke:#ef5b4e,color:#fff
    style Canonical fill:#1a2e1a,stroke:#22c55e,color:#fff
    style Audit fill:#1a1a2e,stroke:#3b82f6,color:#fff
```

### Database Relationships

```mermaid
erDiagram
    CATALOG ||--o{ IMPORT_BATCH : "has imports"
    CATALOG ||--o{ CANONICAL_PRODUCT : "contains products"
    IMPORT_BATCH ||--o{ SOURCE_RECORD : "contains rows"
    CANONICAL_PRODUCT ||--o{ SOURCE_RECORD : "sourced from"
    CANONICAL_PRODUCT ||--o{ FIELD_PROVENANCE : "field origins"
    CANONICAL_PRODUCT ||--o{ CANONICAL_PRODUCT_HISTORY : "change log"
    SOURCE_RECORD ||--o{ FIELD_PROVENANCE : "maps fields"
    SOURCE_RECORD ||--o{ CANONICAL_PRODUCT_HISTORY : "triggered by"

    CATALOG {
        uuid id PK
        uuid organization_id
        varchar name
        timestamp created_at
    }

    IMPORT_BATCH {
        uuid id PK
        uuid catalog_id FK
        varchar filename
        varchar file_type
        varchar status
        int total_rows
        int successful_rows
        jsonb detected_headers
        jsonb field_mappings
    }

    CANONICAL_PRODUCT {
        uuid id PK
        uuid catalog_id FK
        varchar sku "partial unique index"
        varchar gtin
        varchar brand
        varchar product_name
        varchar lifecycle_status
        varchar data_quality_status
        jsonb attributes
        jsonb dimensions
        jsonb packaging
        jsonb compliance
        jsonb digital_assets
        jsonb identifiers
    }

    SOURCE_RECORD {
        uuid id PK
        uuid import_batch_id FK
        uuid canonical_product_id FK
        int row_number
        jsonb raw_payload_json "immutable"
        varchar parse_status
    }

    FIELD_PROVENANCE {
        uuid id PK
        uuid canonical_product_id FK
        uuid source_record_id FK
        varchar canonical_field
        varchar source_field
        text original_value
        text normalized_value
        varchar normalization_method
    }

    CANONICAL_PRODUCT_HISTORY {
        uuid id PK
        uuid canonical_product_id FK
        uuid source_record_id FK
        varchar field "dot-notation path"
        text previous_value
        text new_value
        varchar actor
        timestamp created_at
    }
```

Key constraints:
- `(catalog_id, sku) WHERE sku IS NOT NULL` — partial unique index enforces SKU uniqueness within a catalog while allowing null SKUs (custom SQL; Prisma does not support `WHERE` on `@@unique`)
- `(import_batch_id, row_number)` — unique constraint prevents duplicate source records within an import
- `ON DELETE RESTRICT` on most foreign keys — prevents accidental data loss
- `ON DELETE SET NULL` on `source_record.canonical_product_id` — preserves audit trail if a product is removed

---

## Storage Architecture

```mermaid
flowchart TB
    subgraph Interface["StorageProvider Interface"]
        UPLOAD_OP["upload(key, data, contentType)"]
        DOWNLOAD_OP["download(key)"]
        EXISTS_OP["exists(key)"]
        GETURL_OP["getUrl(key)"]
    end

    subgraph Implementations
        AZURE["AzureBlobStorage\n(production)"]
        LOCAL["LocalFsStorage\n(development / testing)"]
    end

    subgraph Selection["Factory"]
        FACTORY["createStorageProvider(config)\nenv: STORAGE_PROVIDER=azure|local"]
    end

    FACTORY -->|"azure"| AZURE
    FACTORY -->|"local"| LOCAL
    AZURE -.-> Interface
    LOCAL -.-> Interface

    style Interface fill:#1a1a2e,stroke:#3b82f6,color:#fff
```

File storage key format: `{organizationId}/{catalogId}/{timestamp}-{filename}`

Files are stored once during upload and re-read during import confirmation. They are never modified or deleted — the storage layer is append-only by design, supporting audit requirements.

---

## Deployment Architecture

```mermaid
flowchart TB
    subgraph GitHub["GitHub Repository"]
        PUSH["Push to main"]
    end

    subgraph CI_Frontend["Frontend Pipeline"]
        FE_BUILD["Build (Vite)"]
        FE_DEPLOY["Deploy to Azure SWA"]
    end

    subgraph CI_Backend["Backend Pipeline"]
        BE_TEST_LABEL["Test (Vitest, 90 tests)"]
        BE_BUILD["Build (tsc)"]
        BE_DEPLOY["Deploy to Azure App Service"]
    end

    subgraph Azure["Azure"]
        SWA["Static Web Apps\n(CDN + SPA)"]
        APP["App Service\n(Node.js)"]
        PG["PostgreSQL 16"]
        BLOB["Blob Storage"]
    end

    PUSH -->|"all changes"| CI_Frontend
    PUSH -->|"server/** changes"| CI_Backend
    CI_Frontend --> FE_BUILD --> FE_DEPLOY --> SWA
    CI_Backend --> BE_TEST["Test (Vitest, 90 tests)"] --> BE_BUILD --> BE_DEPLOY --> APP
    APP --> PG
    APP --> BLOB
    SWA -.->|"/api/*"| APP

    style GitHub fill:#1c1c1f,stroke:#333,color:#fff
    style Azure fill:#1a1a2e,stroke:#3b82f6,color:#fff
```

| Component | Trigger | Pipeline |
|---|---|---|
| Frontend | Any push to `main` | Build with Vite → deploy to Azure SWA (OIDC auth) |
| Backend | Push to `main` with changes in `server/**` | Run tests → build with tsc → deploy to Azure App Service |

The frontend pipeline deploys on all pushes. The backend pipeline is path-scoped to `server/**` to avoid unnecessary deploys for frontend-only changes.

### Development Environment

During local development, the Vite dev server proxies `/api/v1` requests to `localhost:3000` (the Fastify backend). If the backend is not running, the frontend automatically falls back to demo mode.

```
Browser → localhost:5173 (Vite)
                ├── /api/v1/* → proxy → localhost:3000 (Fastify)
                └── /* → SPA (React)
```

---

## Authentication and Authorization

Authentication uses a provider-neutral `AuthProvider` interface. In development, `DevAuthProvider` validates the Bearer token against the configured `DEV_AUTH_TOKEN` environment variable — incorrect, empty, or missing tokens are rejected with 401. In production, a JWT-validating provider (vendor TBD) will be wired in via `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URI`.

Tenant resolution is handled by `AutoTenantResolver`. For single-org users, the tenant is auto-resolved from their `OrganizationMembership`. For multi-org users, the client sends an `X-Organization-Id` header, which is validated against the user's active memberships. Supporting routes: `GET /me` (user identity) and `GET /me/organizations` (membership listing).

Authorization uses explicit role-to-permission mapping (never string comparison):
- **Roles:** `organization_admin`, `operator`, `viewer`
- **Permissions:** `catalog:read`, `catalog:write`, `product:read`, `import:execute`, `organization:manage`

Operational audit logging records security-relevant events (auth failures, catalog/import operations, org settings changes, authorization denials) in an append-only `AuditLog` table. Request correlation uses `X-Request-Id` headers propagated through requests, responses, and structured logs.

The `AUTH_MODE` environment variable controls the mode (`development` or `production`). Development mode is blocked when `NODE_ENV=production`. `DEV_AUTH_TOKEN` is required in development mode.

---

## Multi-Tenancy

The system supports logical multi-tenancy through `organization_id` on all primary tables:

| Table | Has `organization_id` | Indexed |
|---|---|---|
| `organization` | — (is the tenant) | — |
| `user` | — (cross-tenant) | `idx_user_email` |
| `organization_membership` | Yes (FK) | `uq_membership_org_user`, `idx_membership_user` |
| `catalog` | Yes (FK) | `idx_catalog_org` |
| `import_batch` | Yes (FK) | `idx_import_batch_org` |
| `canonical_product` | Yes (FK) | `idx_product_org` |
| `source_record` | No (via import_batch FK) | — |
| `field_provenance` | No (via canonical_product FK) | — |
| `canonical_product_history` | No (via canonical_product FK) | — |
| `audit_log` | Yes (FK, nullable) | `idx_audit_log_org` |

Tenant isolation is enforced at the application layer: every authenticated request resolves a `TenantContext` from the user's membership, and all queries filter by `tenantContext.organizationId`. Blob storage keys are prefixed with `organizations/{orgId}/` and enforced by `TenantScopedStorage`. PostgreSQL RLS is deferred as defense-in-depth (see MULTI_TENANCY.md).

---

## API Boundaries

All API endpoints are under `/api/v1`. The response envelope is consistent across all endpoints:

**Success:** `{ data: T, meta?: { page, limit, total, totalPages } }`
**Error:** `{ error: { code: string, message: string, details?: object } }`

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Database connectivity check |
| `GET` | `/me` | Auth only | Current user identity |
| `GET` | `/me/organizations` | Auth only | User's org memberships with roles |
| `GET` | `/catalogs` | Tenant | List catalogs (auto-creates default if none) |
| `POST` | `/catalogs` | Tenant | Create a catalog |
| `GET` | `/catalogs/:id` | Tenant | Get catalog with computed stats |
| `POST` | `/catalogs/:catalogId/imports` | Tenant | Upload file, get preview + suggested mappings |
| `GET` | `/catalogs/:catalogId/imports` | Tenant | List imports for a catalog |
| `GET` | `/imports/:id` | Tenant | Get import batch details |
| `POST` | `/imports/:id/confirm` | Tenant | Execute import with field mappings |
| `GET` | `/imports/:id/results` | Tenant | Get import results with counts |
| `GET` | `/catalogs/:catalogId/products` | Tenant | List products (paginated, filterable, searchable) |
| `GET` | `/products/:id` | Tenant | Get single product |
| `GET` | `/products/:id/source-records` | Tenant | Get source records for a product |
| `GET` | `/products/:id/provenance` | Tenant | Get field provenance for a product |
| `GET` | `/products/:id/history` | Tenant | Get change history for a product |
| `GET` | `/organization` | Tenant | Get current org details |
| `PATCH` | `/organization` | Tenant | Update org settings (admin only) |
| `GET` | `/organization/members` | Tenant | List org members |
| `GET` | `/organization/audit-log` | Tenant | List audit log entries (admin only) |

### Error Codes

| HTTP Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid request data |
| 400 | `ORGANIZATION_REQUIRED` | Multi-org user without `X-Organization-Id` header |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication token |
| 403 | `FORBIDDEN` | Insufficient role permissions |
| 403 | `NO_ORGANIZATION` | User has no active memberships |
| 403 | `INVALID_ORGANIZATION` | `X-Organization-Id` not in user's memberships |
| 404 | `NOT_FOUND` | Resource does not exist (or belongs to another org) |
| 413 | `FILE_TOO_LARGE` | Upload exceeds `MAX_UPLOAD_SIZE_MB` |
| 422 | `PARSE_ERROR` | File is parseable but semantically invalid |
| 500 | `INTERNAL_ERROR` | Unexpected server error (message suppressed in production) |
| 500 | `STORAGE_ERROR` | File storage operation failed |
| 503 | (health only) | Database unreachable |

---

## Future Expansion

The architecture is designed to support the following expansions without requiring a rewrite:

### Step 2: Retailer Readiness Engine
- Requires a **Retail Intelligence Library** — structured retailer schemas, field requirements, validation rules
- Readiness scoring will query canonical products against retailer schemas
- The canonical product model and JSONB flexible fields are designed to accommodate retailer-specific attributes

### Step 3: Mapping Studio
- Field mapping rules will be persisted (currently, mappings are per-import and stored on the import batch)
- Mappings will be reusable across imports and configurable per retailer
- AI-suggested mappings will build on the existing `suggestFieldMappings()` alias table

### Step 4: Validation & Exceptions
- Validation rules will reference the Retail Intelligence Library
- Auto-heal suggestions will be generated by AI but require human approval
- Exception routing will use the canonical product's `data_quality_status` as an input signal

### Step 5: Delivery
- Payload generation will transform canonical products into retailer-specific formats
- The canonical model's typed core fields + JSONB structure supports arbitrary output schemas
- File delivery and API push capabilities will use the existing storage abstraction

### Step 6: Retail Feedback
- Retailer rejections will be ingested and parsed
- Rejections will be linked to canonical products and routed back into the validation step
- Field provenance enables tracing a rejection to its source system

### AI Agents (Step 6+)
- Source records provide training data for field mapping models
- Provenance records provide evaluation data for normalization quality
- Change history provides a feedback signal for auto-heal accuracy
- The deferred product identity layer (ADR-011) will support AI-driven product reconciliation

### Async Processing
- The synchronous import pipeline can be extracted to a job worker
- The `ImportService` class is already decoupled from the HTTP layer
- Add a job table, move `confirmImport` to a worker, change the HTTP endpoint to return a job ID

### Event-Driven Architecture
- Domain events (`ProductCreated`, `ProductUpdated`, `FieldChanged`) can be emitted from the import service
- Multiple consumers (readiness recalculation, webhook notifications, search index updates) can subscribe
- The per-row transaction boundary is the natural event emission point
