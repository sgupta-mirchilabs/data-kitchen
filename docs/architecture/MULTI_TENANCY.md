# Data Kitchen Multi-Tenancy Architecture

> **Last updated:** 2026-08-02
> **Status:** Implemented — application-level tenant isolation enforced
> **Scope:** Configurable, production-grade multi-tenant foundation
> **Authors:** Sudu Gupta (Mirchi Labs)
> **Companion documents:** [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md), [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md), [DATA_MODEL.md](./DATA_MODEL.md)

---

## Executive Summary

Data Kitchen operates as a multi-tenant SaaS platform where each organization's data is fully isolated. The application enforces tenant isolation at every layer: authentication via `DEV_AUTH_TOKEN` (development) or JWT (production), tenant resolution from `OrganizationMembership`, org-scoped queries on all routes, role-based authorization with explicit permission mapping, tenant-prefixed blob storage with validation, and append-only audit logging for security-relevant operations.

This document records the initial audit (Section 1, now historical), defines the production architecture (Section 2), and tracks implementation status (Section 12).

---

## 1. Pre-Implementation Audit (Historical)

> **Status:** All issues identified in this section have been resolved. This section is preserved as a historical record of the pre-implementation state. See Section 12 for current readiness status.

### 1.1 Where organization_id Comes From

`organization_id` originates from a single source: the `DEFAULT_ORG_ID` environment variable, defaulting to `00000000-0000-0000-0000-000000000001`.

```
config.ts → loadConfig() → defaultOrgId: optional("DEFAULT_ORG_ID", "00000000-...")
```

It is consumed in exactly three places:

| Location | Usage |
|---|---|
| `catalog.routes.ts` line 6 | `GET /catalogs` — filters catalog list |
| `catalog.routes.ts` line 30 | `POST /catalogs` — sets org on new catalog |
| `import.routes.ts` line 14 | `POST /catalogs/:catalogId/imports` — passed to import service |

Every other route ignores `organizationId` entirely.

The value is:
- **Hardcoded** in the server configuration
- **Never read** from any request header, JWT, session, or cookie
- **Never validated** against any user identity
- **Shared** across all requests — there is no per-request tenant resolution

### 1.2 User Identity

User identity is tracked via freeform string fields (`created_by`, `updated_by`, `uploaded_by`, `actor`), all populated from `config.defaultUser` which defaults to `"system"`. There is:

- No `User` model in the database
- No `Organization` model in the database
- No `OrganizationMembership` model in the database
- No authentication middleware of any kind
- No JWT, session, API key, or token validation
- No authorization checks on any route

All routes are fully unauthenticated and publicly accessible.

### 1.3 API Routes — Tenant Isolation Status

| Route | Method | Tenant Data | Org Scoped | Vulnerability |
|---|---|---|---|---|
| `/health` | GET | No | N/A | None |
| `/catalogs` | GET | Yes | **Yes** (config default) | Single-org only |
| `/catalogs` | POST | Yes | **Yes** (config default) | Single-org only |
| `/catalogs/:id` | GET | Yes | **No** | **ID-only lookup** |
| `/catalogs/:catalogId/imports` | POST | Yes | **No** | **Catalog not org-verified** |
| `/catalogs/:catalogId/imports` | GET | Yes | **No** | **No org filter** |
| `/imports/:id` | GET | Yes | **No** | **ID-only lookup** |
| `/imports/:id/confirm` | POST | Yes | **No** | **ID-only lookup** |
| `/imports/:id/results` | GET | Yes | **No** | **ID-only lookup** |
| `/catalogs/:catalogId/products` | GET | Yes | **No** | **No org filter** |
| `/products/:id` | GET | Yes | **No** | **ID-only lookup** |
| `/products/:id/source-records` | GET | Yes | **No** | **No org filter on parent** |
| `/products/:id/provenance` | GET | Yes | **No** | **No org filter on parent** |
| `/products/:id/history` | GET | Yes | **No** | **No org filter on parent** |

**Result: 11 of 13 tenant-data routes perform lookups by resource ID alone without organization scoping.**

### 1.4 Prisma Queries Without Organization Scoping

Every query below is performed without an `organizationId` filter:

| Service/Route | Query Pattern | Risk |
|---|---|---|
| `catalog.routes.ts` | `findUnique({ where: { id } })` | Cross-tenant catalog read |
| `import.routes.ts` | `findUnique({ where: { id: catalogId } })` | Import into another org's catalog |
| `import.routes.ts` | `findMany({ where: { catalogId } })` | List another org's imports |
| `import.routes.ts` | `findUnique({ where: { id } })` | Read another org's import |
| `import.service.ts` | `findUnique({ where: { id } })` on ImportBatch | Confirm another org's import |
| `import.service.ts` | `findUnique({ where: { id: productId } })` | Update another org's product |
| `duplicate-resolver.ts` | `findFirst({ where: { catalogId, sku } })` | Duplicate match within unverified catalog |
| `product.routes.ts` | `findMany({ where: { catalogId } })` | List another org's products |
| `product.routes.ts` | `findUnique({ where: { id } })` | Read another org's product |
| `product.routes.ts` | `findMany({ where: { canonicalProductId } })` | Read another org's source records |
| `product.routes.ts` | `findMany({ where: { canonicalProductId } })` | Read another org's provenance |
| `product.routes.ts` | `findMany({ where: { canonicalProductId } })` | Read another org's history |

### 1.5 Nested Resource Ownership Verification

No nested route verifies that the parent resource belongs to the requesting organization:

| Route | Parent Lookup | Ownership Check |
|---|---|---|
| `POST /catalogs/:catalogId/imports` | `findUnique({ where: { id: catalogId } })` | **None** |
| `GET /catalogs/:catalogId/imports` | Query uses `catalogId` directly | **None** |
| `GET /catalogs/:catalogId/products` | Query uses `catalogId` directly | **None** |
| `GET /products/:id/source-records` | Query uses `canonicalProductId` directly | **None** |
| `GET /products/:id/provenance` | Query uses `canonicalProductId` directly | **None** |
| `GET /products/:id/history` | Query uses `canonicalProductId` directly | **None** |

### 1.6 Default Organization Leak Risk

The `DEFAULT_ORG_ID` and `DEFAULT_USER` values are baked into the server config with hardcoded fallback values. If these environment variables are not set in production:

- Every request silently uses `00000000-0000-0000-0000-000000000001` as the organization
- Every mutation records `"system"` as the actor
- No error or warning is produced
- The application starts and serves requests normally

This means a misconfigured production deployment could silently operate in single-tenant development mode.

### 1.7 Blob Storage Tenant Isolation

Storage paths are constructed with an organization prefix:

```typescript
const storageKey = `${organizationId}/${catalogId}/${Date.now()}-${filename}`;
```

This provides isolation **by convention only**. The `StorageProvider` interface accepts raw string keys with:

- No validation that the key starts with the correct org prefix
- No path traversal protection in `LocalFsStorage` (a key like `../../other-org/file` could escape)
- No tenant context awareness in the storage abstraction
- No ownership verification before downloads (the key comes from `batch.fileStorageKey`)

### 1.8 Information Exposure

API responses currently include `organizationId` on catalogs, import batches, and products. Error messages in development mode expose internal error details. There is no redaction of cross-tenant identifiers because there is no tenant boundary to enforce.

### 1.9 Audit Summary

| Concern | Current State | Production Ready |
|---|---|---|
| Authentication | None | **No** |
| Authorization | None | **No** |
| Organization model | No database entity | **No** |
| User model | No database entity | **No** |
| Membership model | No database entity | **No** |
| Tenant identity resolution | Hardcoded config value | **No** |
| Org-scoped queries | 2 of 13 routes | **No** |
| Cross-tenant protection | None | **No** |
| Nested resource ownership | None | **No** |
| Blob storage isolation | Convention only | **No** |
| Default org leak prevention | No safeguard | **No** |
| Audit trail actor identity | Hardcoded `"system"` | **No** |

---

## 2. Required Production Architecture

### 2.1 Domain Model

Three new entities are required:

```
┌─────────────────────┐       ┌──────────────────────────────┐
│     Organization     │       │           User               │
├─────────────────────┤       ├──────────────────────────────┤
│ id            (uuid)│       │ id                    (uuid) │
│ name       (varchar)│       │ external_identity_id(varchar)│
│ slug       (varchar)│       │ email              (varchar) │
│ status     (varchar)│       │ display_name       (varchar) │
│ settings     (jsonb)│       │ status             (varchar) │
│ created_at  (tstz)  │       │ created_at           (tstz)  │
│ updated_at  (tstz)  │       │ updated_at           (tstz)  │
└────────┬────────────┘       └──────────┬───────────────────┘
         │                               │
         │    ┌──────────────────────┐    │
         └────┤ OrganizationMembership├───┘
              ├──────────────────────┤
              │ id            (uuid) │
              │ organization_id (fk) │
              │ user_id         (fk) │
              │ role         (varchar│
              │ status       (varchar│
              │ created_at    (tstz) │
              │ updated_at    (tstz) │
              └──────────────────────┘
```

**Organization** — The tenant boundary. All data belongs to exactly one organization. The `settings` JSONB column holds configurable operational parameters (see Section 10). The `slug` enables URL-friendly org identifiers and is unique. Status values: `active`, `suspended`, `archived`.

**User** — Represents an authenticated individual. `external_identity_id` links to the authentication provider's user ID (Entra ID, Auth0, etc.) and is unique. The `email` field is stored for display and contact purposes, not for authentication. Status values: `active`, `suspended`.

**OrganizationMembership** — Links users to organizations with a role. A user may belong to multiple organizations. Status values: `active`, `suspended`, `removed`.

**Initial roles:**

| Role | Description |
|---|---|
| `organization_admin` | Full organization access — settings, memberships (future), all data operations |
| `operator` | Create/run imports, manage catalog data, view provenance and history |
| `viewer` | Read-only access to catalogs, products, provenance, and history |

A simple role model is sufficient. Do not build a general-purpose permissions engine. Authorization uses a centralized, explicit role-to-permission mapping (see Section 2.7).

**Schema constraints:**

- `OrganizationMembership` has a unique constraint on `(organization_id, user_id)` — a user cannot hold two memberships in the same organization.
- There is **no** unique constraint on `user_id` alone — the schema supports a user belonging to multiple organizations from day one.

### 2.2 Tenant Identity Resolution

**Implemented behavior: automatic resolution for single-org users, explicit `X-Organization-Id` header for multi-org users.**

The schema supports many-to-many (User ↔ Organization). The `AutoTenantResolver` resolves the tenant automatically when the user has exactly one active membership. For users with multiple memberships (e.g., Mirchi Labs employees), the client must send the `X-Organization-Id` header, which is validated against the user's active memberships.

**Resolution flow:**

```
HTTP Request
  → Authentication middleware extracts verified user identity from token
  → Resolve User record from external_identity_id
  → AutoTenantResolver.resolve(user, request)
    → Query OrganizationMembership for user's active memberships
    → If exactly one active membership → set TenantContext.organizationId
    → If zero memberships → 403 Forbidden ("NO_ORGANIZATION")
    → If multiple memberships and X-Organization-Id header present:
      → Validate header value against user's memberships
      → If valid → set TenantContext.organizationId
      → If invalid → 403 Forbidden ("INVALID_ORGANIZATION")
    → If multiple memberships and no header → 400 ("ORGANIZATION_REQUIRED")
```

**Supporting routes:**

| Route | Purpose |
|---|---|
| `GET /me` | Returns authenticated user's identity |
| `GET /me/organizations` | Lists user's active memberships with roles |

**TenantResolver interface:**

```typescript
interface TenantResolver {
  resolve(user: ResolvedUser, selectedOrganizationId?: string): Promise<TenantContext>;
}
```

The `AutoTenantResolver` implements this interface. Services and routes are unaware of the resolution strategy — they receive `TenantContext` regardless of how it was resolved.

**What is never trusted from the client:**
- `organization_id` in request body
- `organization_id` in query parameters
- `organization_id` in localStorage
- `organization_id` in arbitrary headers (without membership validation)
- `organization_id` in route parameters (without membership validation)

### 2.3 Authentication Boundary

The authentication layer must be provider-neutral. The application domain depends on abstractions, not on a specific identity vendor.

**Core interfaces:**

```typescript
interface AuthProvider {
  validateToken(token: string): Promise<AuthenticatedUser>;
  getJwksUri(): string;
}

interface AuthenticatedUser {
  externalId: string;         // Provider's user ID
  email: string;
  displayName: string;
  rawClaims: Record<string, unknown>;
}

interface TenantContext {
  userId: string;             // Data Kitchen user.id
  organizationId: string;     // Resolved from membership
  role: string;               // From OrganizationMembership
  displayName: string;
}
```

**AUTH_MODE configuration:**

| Mode | Behavior |
|---|---|
| `development` | Requires `DEV_AUTH_TOKEN` env var. `DevAuthProvider` validates the token from the `Authorization: Bearer <token>` header. Rejects incorrect, empty, or missing tokens with 401. Must fail to start when `NODE_ENV=production`. Logs a warning at startup. |
| `production` | Requires verified JWT tokens. Rejects unauthenticated requests. Derives identity from token claims. |

**Development mode safeguards:**

1. `AUTH_MODE=development` fails to start when `NODE_ENV=production`.
2. `DEV_AUTH_TOKEN` is required — startup fails if missing.
3. `DevAuthProvider` validates the bearer token against `DEV_AUTH_TOKEN`. Incorrect tokens are rejected with 401 and an audit log entry.
4. No hardcoded tokens exist anywhere in the codebase — token is configured via environment variable only.
5. The development user and organization are created by a seed script with safety guards (see seed script section).
6. Frontend uses `VITE_DEV_AUTH_TOKEN` — only sent as `Authorization: Bearer` when configured; no fallback.

**Viable production providers (no vendor selected yet):**

| Provider | Type | Notes |
|---|---|---|
| Microsoft Entra ID | Enterprise IdP | Natural fit for Azure infrastructure. OIDC + JWKS. |
| Auth0 | Managed auth | Provider-neutral, multi-tenant capable, free tier available. |
| Clerk | Managed auth | Developer-friendly, good React integration, organizations built-in. |
| Supabase Auth | Open source | PostgreSQL-native, free tier, good Prisma integration. |
| Custom JWT | Self-managed | Maximum control, maximum maintenance burden. |

**Recommendation:** Defer vendor selection. Build the `AuthProvider` interface and development mode first. Select a provider when the first customer integration requires it. The interface ensures the choice is non-committal.

### 2.4 Tenant-Scoped Data Access

**Principle: Every query that touches tenant-owned data must include `organizationId` in its WHERE clause, or scope through a parent that does.**

#### Which tables should have organization_id directly

| Table | Has org_id Now | Should Have org_id | Rationale |
|---|---|---|---|
| `organization` | Is the org | N/A | Self |
| `user` | No | No | Users are cross-org entities |
| `organization_membership` | Yes (FK) | Yes | Links user to org |
| `catalog` | Yes | Yes | Top-level tenant boundary |
| `import_batch` | Yes | Yes | Denormalized — avoids join to catalog for org-scoped queries |
| `canonical_product` | Yes | Yes | Denormalized — same rationale |
| `source_record` | **No** | **No** | Scoped through `import_batch`. Adding org_id would be pure duplication with no query benefit — source records are always accessed via their batch or product. |
| `field_provenance` | **No** | **No** | Scoped through `canonical_product`. Same rationale. |
| `canonical_product_history` | **No** | **No** | Scoped through `canonical_product`. Same rationale. |

**Tradeoff:** Defense-in-depth duplication (adding `organization_id` to leaf tables) would allow direct org-scoped queries on leaf tables and provide a safety net if a parent join is accidentally omitted. However, it adds a column, an index, and a write cost to every row in the three highest-volume tables — and the org value must be kept in sync with the parent. The current denormalization onto the three top-level tables (catalog, import_batch, canonical_product) is the right balance: these are the tables that have independent query access patterns. Leaf tables are always accessed through their parent.

**Required query patterns:**

For tables with `organization_id`:

```typescript
// Direct scoping — required for all top-level lookups
prisma.catalog.findUnique({
  where: { id: catalogId, organizationId: tenantContext.organizationId }
});

prisma.catalog.findMany({
  where: { organizationId: tenantContext.organizationId }
});
```

For tables without `organization_id` — scope through parent:

```typescript
// Source records — scope through import batch
prisma.sourceRecord.findMany({
  where: {
    importBatch: { organizationId: tenantContext.organizationId },
    canonicalProductId: productId
  }
});

// Provenance — scope through canonical product
prisma.fieldProvenance.findMany({
  where: {
    canonicalProduct: { organizationId: tenantContext.organizationId },
    canonicalProductId: productId
  }
});
```

**Queries that must change:**

Every `findUnique({ where: { id } })` and `findFirst({ where: { catalogId } })` on a tenant-owned table must add `organizationId` to the WHERE clause. Specifically:

1. `catalog.routes.ts` — `GET /catalogs/:id` must add org filter
2. `import.routes.ts` — `POST /catalogs/:catalogId/imports` must verify catalog ownership
3. `import.routes.ts` — `GET /catalogs/:catalogId/imports` must verify catalog ownership
4. `import.routes.ts` — `GET /imports/:id` must add org filter
5. `import.routes.ts` — `POST /imports/:id/confirm` must add org filter
6. `import.routes.ts` — `GET /imports/:id/results` must add org filter
7. `import.service.ts` — `confirmImport()` must accept and verify org context
8. `duplicate-resolver.ts` — `findDuplicate()` already scopes by catalogId (adequate since catalogs are org-scoped)
9. `product.routes.ts` — All 5 product routes must add org filters

### 2.5 Data Access Architecture

**Approach: Service methods requiring TenantContext, with Prisma extension as a safety net.**

Every service method that accesses tenant-owned data must require `TenantContext` as its first parameter:

```typescript
interface TenantContext {
  userId: string;
  organizationId: string;
  role: string;
  displayName: string;
}

// Service method signatures
getCatalog(ctx: TenantContext, catalogId: string): Promise<Catalog>
listProducts(ctx: TenantContext, catalogId: string, filters: ProductFilters): Promise<PaginatedResult<Product>>
uploadAndPreview(ctx: TenantContext, catalogId: string, filename: string, buffer: Buffer): Promise<ImportPreview>
confirmImport(ctx: TenantContext, importId: string, mappings: FieldMappings): Promise<ImportResult>
```

**Why not Prisma middleware alone:** Prisma middleware (deprecated in Prisma 6) or Prisma Client Extensions can automatically inject `organizationId` into queries, but they:
- Cannot distinguish tenant-owned from system tables
- Cannot handle tables that scope through parent relations (source_record, provenance, history)
- Obscure the tenant boundary — developers cannot see the org filter in the code
- Make testing harder — the middleware applies globally

**Recommended layered approach:**

1. **Primary enforcement:** Service methods require `TenantContext`. The org filter is explicit in every query.
2. **Defensive layer:** A Prisma Client Extension logs a warning (development) or throws (production) when a query on a tenant-owned table lacks `organizationId` in its WHERE clause. This catches accidental omissions.

```typescript
// Defensive Prisma extension — catches queries missing org scope
const prismaWithTenantGuard = prisma.$extends({
  query: {
    catalog: {
      async findUnique({ args, query }) {
        if (!args.where.organizationId) {
          throw new Error("catalog.findUnique requires organizationId");
        }
        return query(args);
      }
    },
    // ... same for importBatch, canonicalProduct
  }
});
```

This is defense-in-depth, not the primary mechanism. The primary mechanism is explicit `TenantContext` on every service call.

### 2.6 Authentication Middleware

A Fastify `onRequest` hook resolves the authenticated user and tenant context before any route handler executes:

```
Request → CORS → Auth Middleware → Route Handler
                     │
                     ├── Extract Bearer token from Authorization header
                     ├── Validate token via AuthProvider
                     ├── Resolve User from external_identity_id
                     ├── Resolve OrganizationMembership
                     ├── Build TenantContext
                     └── Attach to request (request.tenantContext)
```

Routes that do not require authentication (e.g., `/health`) are explicitly excluded.

### 2.7 Authorization

Authorization uses a centralized, explicit role-to-permission mapping. Roles are never compared as strings, alphabetically, or ordinally. Each route checks a specific permission, which is resolved from the role via a static mapping.

**Permission definitions:**

| Permission | Description |
|---|---|
| `catalog:read` | View catalogs and their stats |
| `catalog:write` | Create catalogs |
| `product:read` | View products, source records, provenance, history |
| `import:execute` | Upload files and confirm imports |
| `organization:manage` | View/update organization settings, manage memberships (future) |

**Role-to-permission mapping (centralized, explicit):**

```typescript
const ROLE_PERMISSIONS: Record<string, string[]> = {
  organization_admin: [
    "catalog:read",
    "catalog:write",
    "product:read",
    "import:execute",
    "organization:manage",
  ],
  operator: [
    "catalog:read",
    "catalog:write",
    "product:read",
    "import:execute",
  ],
  viewer: [
    "catalog:read",
    "product:read",
  ],
};

function hasPermission(role: string, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions !== undefined && permissions.includes(permission);
}

function requirePermission(permission: string) {
  return (request: FastifyRequest) => {
    if (!hasPermission(request.tenantContext.role, permission)) {
      throw new AppError(403, "FORBIDDEN", "Insufficient permissions");
    }
  };
}
```

**Usage in routes:**

```typescript
// Read routes — any authenticated user with catalog:read
fastify.get("/catalogs", async (request, reply) => {
  requirePermission("catalog:read")(request);
  // ...
});

// Write routes — requires import:execute
fastify.post("/catalogs/:catalogId/imports", async (request, reply) => {
  requirePermission("import:execute")(request);
  // ...
});

// Admin routes — requires organization:manage
fastify.patch("/organizations/:id/settings", async (request, reply) => {
  requirePermission("organization:manage")(request);
  // ...
});
```

**Permission matrix (derived from the mapping above):**

| Action | organization_admin | operator | viewer |
|---|---|---|---|
| View catalogs (`catalog:read`) | Yes | Yes | Yes |
| Create catalog (`catalog:write`) | Yes | Yes | No |
| View products/provenance/history (`product:read`) | Yes | Yes | Yes |
| Import data (`import:execute`) | Yes | Yes | No |
| Manage org settings (`organization:manage`) | Yes | No | No |
| Manage memberships — future (`organization:manage`) | Yes | No | No |

---

## 3. Database Isolation — PostgreSQL Row-Level Security

### 3.1 Evaluation

| Factor | Assessment |
|---|---|
| **Benefit** | Defense-in-depth — even a SQL injection or application bug cannot cross tenant boundaries |
| **Prisma compatibility** | Prisma does not natively support `SET app.current_org` per request. Requires raw SQL or a Prisma extension to set the session variable before each query. |
| **Connection pooling** | RLS with session variables (`SET LOCAL`) works within a transaction. PgBouncer in transaction mode supports this. Prisma's built-in pooler uses transaction mode by default. |
| **Migration complexity** | Moderate — requires policies on 3 tables (catalog, import_batch, canonical_product), a session variable, and a connection hook. |
| **Performance** | Negligible — PostgreSQL evaluates RLS policies as additional WHERE clauses. The `organization_id` indexes already exist. |
| **Risk** | If the session variable is not set, the default policy should deny all access (fail-closed). This is safe but means a bug in the session-variable setup blocks all queries rather than leaking data. |

### 3.2 Decision: Deferred

**Status:** Deferred — implement after application-level tenant enforcement is proven.

**Rationale:** Application-level enforcement (Section 2.4 + 2.5) is the primary mechanism. RLS adds a second layer that protects against application bugs but introduces Prisma integration complexity that is not justified before the first customer deployment. The Prisma extension safety net (Section 2.5) provides a similar "catch accidental omissions" benefit with lower integration cost.

**When to implement:** Before the first multi-tenant production deployment with customer data from more than one organization.

**Implementation sketch when ready:**

```sql
-- Enable RLS
ALTER TABLE catalog ENABLE ROW LEVEL SECURITY;

-- Policy: rows visible only when session org matches
CREATE POLICY tenant_isolation ON catalog
  USING (organization_id = current_setting('app.current_org')::uuid);

-- Set per-request (in Prisma extension or middleware)
SET LOCAL app.current_org = '<organization-uuid>';
```

---

## 4. Blob Storage Isolation

### 4.1 Required Storage Key Format

```
organizations/{organizationId}/catalogs/{catalogId}/imports/{importId}/{filename}
```

Changes from current format (`{orgId}/{catalogId}/{timestamp}-{filename}`):
- Explicit `organizations/` prefix prevents confusion with other top-level paths
- `imports/{importId}/` replaces timestamp — aligns with data model, prevents collisions
- Filename is sanitized (see below)

### 4.2 Required Safeguards

| Safeguard | Current | Required |
|---|---|---|
| Tenant prefix in key | Convention only | Enforced by storage abstraction |
| Ownership before download | None | Verify import batch belongs to org |
| Filename sanitization | None | Strip path separators, null bytes, control chars |
| Path traversal protection | None | Reject keys containing `..` |
| Container access | Private (Azure default) | Verify: private, no public access |
| Frontend credential exposure | None (backend-only) | Maintain: no storage credentials to frontend |
| Scoped access tokens | Not implemented | Use SAS tokens with org-scoped path prefix |

### 4.3 Storage Abstraction Changes

The `StorageProvider` interface should gain a `TenantContext`-aware wrapper or factory:

```typescript
function createTenantScopedStorage(
  provider: StorageProvider,
  tenantContext: TenantContext
): StorageProvider {
  const orgPrefix = `organizations/${tenantContext.organizationId}`;

  return {
    async upload(key, data, contentType) {
      const scopedKey = `${orgPrefix}/${key}`;
      validateStorageKey(scopedKey);
      return provider.upload(scopedKey, data, contentType);
    },
    async download(key) {
      if (!key.startsWith(orgPrefix)) {
        throw new AppError(403, "FORBIDDEN", "Storage key outside tenant scope");
      }
      return provider.download(key);
    },
    // ... exists, getUrl with same prefix enforcement
  };
}

function validateStorageKey(key: string): void {
  if (key.includes("..")) throw new AppError(400, "INVALID_KEY", "Path traversal not allowed");
  if (/[\x00-\x1f]/.test(key)) throw new AppError(400, "INVALID_KEY", "Control characters not allowed");
}
```

---

## 5. Organization Configuration

### 5.1 Hybrid Model

Organization settings use a hybrid of typed columns and validated JSONB:

**Typed columns** — for security-critical and frequently queried settings:

| Column | Type | Default | Why Typed |
|---|---|---|---|
| `name` | `varchar(255)` | Required | Display, search, uniqueness candidate |
| `slug` | `varchar(100)` | Required | URL-safe identifier, unique |
| `status` | `varchar(20)` | `'active'` | Gates all access — must be indexable |

**JSONB `settings`** — for operational configuration:

```typescript
interface OrganizationSettings {
  display?: {
    brandColor?: string;
    logoUrl?: string;
  };
  imports?: {
    maxFileSizeMb?: number;       // Override global MAX_UPLOAD_SIZE_MB
    maxImportRows?: number;       // Override global MAX_IMPORT_ROWS
    allowedFileTypes?: string[];  // Default: ["csv", "json"]
  };
  locale?: {
    timezone?: string;            // Default: "UTC"
    defaultLocale?: string;       // Default: "en-US"
  };
  quality?: {
    autoArchiveThreshold?: number;
  };
  features?: Record<string, boolean>;  // Feature flags per org
}
```

### 5.2 Validation Requirements

1. **Server-side validation** — The `PATCH /organizations/:id/settings` endpoint validates the settings object against a schema before persisting. Unknown keys are rejected.
2. **Safe defaults** — Every setting has a documented default value. Missing keys fall back to the default.
3. **Security-critical settings** — `maxFileSizeMb` and `maxImportRows` have absolute maximums enforced server-side, regardless of what the organization setting requests.
4. **No arbitrary objects** — The settings JSONB is validated against a known TypeScript type. A raw, unvalidated JSON object must never control security behavior.

### 5.3 Future Settings (not implemented now)

The following settings will be needed in later phases but should not be added until those phases are built:

- Default catalog
- Enabled retailers
- Data retention policies
- Source-system configuration
- Delivery configuration
- Quality scoring thresholds

---

## 6. API Design

### 6.1 New Routes

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/me` | Any authenticated | Returns current user profile and active organization |
| `GET` | `/me/organizations` | Any authenticated | Lists user's organization memberships |
| `GET` | `/organizations/:id` | `organization_admin` | Returns organization details and settings |
| `PATCH` | `/organizations/:id/settings` | `organization_admin` | Updates organization settings |

### 6.2 Response Hygiene

- API responses should not unnecessarily expose `organizationId` in list responses. It is acceptable in single-resource responses where the caller already knows the org context.
- Internal identity-provider claims (`rawClaims`) must never appear in API responses.
- Error responses must not include identifiers from other organizations.

---

## 7. Interim Internal-Test Mode

Before customer production, Data Kitchen will operate in an internal-test configuration:

| Aspect | Internal-Test Mode |
|---|---|
| Authentication | `AUTH_MODE=development` with seeded users |
| Organizations | 1-2 seeded organizations |
| Users | 2-3 seeded users with different roles |
| Tenant isolation | Fully enforced (same code path as production) |
| Authorization | Fully enforced |
| Blob isolation | Fully enforced with org-prefixed keys |
| RLS | Not enabled (deferred) |

**Why the internal-test mode runs the same enforcement code as production:** The purpose of internal testing is to validate the production code paths. A separate "relaxed" test mode would test different code and provide false confidence.

The only difference between internal-test and production is the authentication provider — development mode uses seeded database identities instead of JWT tokens from an IdP. The tenant isolation, authorization, and data access code is identical.

---

## 8. Deferred Enterprise Capabilities

The following capabilities are intentionally deferred. Each includes the trigger for implementation.

| Capability | Trigger | Notes |
|---|---|---|
| Multi-org per user (Approach B) | First customer with multiple brands | Add `X-Organization-Id` header, validate against memberships |
| Fine-grained permissions (RBAC) | >3 distinct permission patterns | Replace role strings with a permission set |
| PostgreSQL Row-Level Security | First multi-customer production deployment | See Section 3 |
| Audit logging service | Compliance requirement from a customer | Structured audit events beyond change history |
| Rate limiting per organization | Public API or high-traffic customer | Token bucket per org, configurable limits |
| Organization data export | Customer offboarding or data portability request | Tenant-scoped data dump |
| Organization deletion | First customer offboarding | Soft delete → data retention period → hard delete |
| SSO/SAML integration | Enterprise customer requirement | Extend AuthProvider interface |
| IP allowlisting | Enterprise security requirement | Middleware check against org settings |

---

## 9. Architecture Decision Records

### ADR-019: Multi-Tenant Architecture

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Data Kitchen must support multiple organizations with isolated data. The existing schema includes `organization_id` columns but no enforcement.

**Decision:** Logical multi-tenancy with application-level enforcement. All tenants share the same database and tables, isolated by `organization_id` in queries.

**Alternatives considered:**
- **Database-per-tenant:** Maximum isolation but operationally expensive — requires connection management per tenant, migration coordination across databases, and prevents cross-tenant analytics. Unjustified at current scale.
- **Schema-per-tenant:** Same PostgreSQL instance, separate schemas. Better isolation than shared tables but the same operational complexity for migrations. Prisma does not natively support dynamic schema selection.
- **Logical isolation (shared tables + org_id):** Simple, well-understood, supported by Prisma. Requires disciplined query patterns and application-level enforcement. Adequate for current scale with RLS available as defense-in-depth when needed.

**Rationale:** Shared-table logical isolation matches the existing schema design, is natively supported by Prisma, and avoids operational complexity that is not justified by current scale or compliance requirements. The migration path to stronger isolation (RLS, schema-per-tenant) is well-documented and incremental.

---

### ADR-020: Tenant Context Resolution — Auto-Resolve with Schema Supporting Multi-Org

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The backend must determine which organization a request belongs to. Options range from client-supplied org ID to automatic resolution from authenticated identity.

**Decision:** The schema supports many-to-many User ↔ Organization via `OrganizationMembership` with a unique constraint on `(organization_id, user_id)` — not on `user_id` alone. For the initial release, the application automatically resolves the tenant when the user has exactly one active membership. If multiple active memberships exist, the request is rejected with 400 until active-org selection is implemented. A `TenantResolver` interface abstracts the resolution strategy so it can be swapped without changing services or routes.

**Alternatives considered:**
- **Unique constraint on user_id (schema-level single-org):** Would prevent future multi-org without a migration. Rejected — schema should not restrict what is an application-level behavior decision.
- **Client-supplied org header from day one (Approach B):** More flexible but adds UX complexity (org switcher), API complexity (header parsing + validation), and a new error case (invalid org selection). No customer has requested multi-org access.
- **Org ID from route parameter:** Would require changing every route URL. Does not scale to cross-org resources. Rejected.

**Rationale:** The schema supports many-to-many from day one, avoiding a migration when multi-org is needed. The application-level restriction (auto-resolve single membership) is the simplest approach that satisfies current requirements. The `TenantResolver` interface makes the switch to header-based resolution a one-class change.

**Migration path:** Implement a `HeaderTenantResolver` that reads `X-Organization-Id` from the request, validates it against the user's active memberships, and returns a `TenantContext`. Swap the resolver in the DI configuration. No service or route changes required.

---

### ADR-021: Provider-Neutral Authentication Abstraction

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** The backend needs authentication. Selecting a specific vendor now would create a dependency that is expensive to change later.

**Decision:** Define an `AuthProvider` interface that abstracts token validation. Support `AUTH_MODE=development` for local and internal testing, with automatic disablement when `NODE_ENV=production`.

**Alternatives considered:**
- **Select Auth0/Clerk/Entra now:** Would provide a working authentication system faster, but locks in a vendor choice before customer requirements are known.
- **Build custom JWT validation:** Maximum control but reinvents well-solved problems (key rotation, token refresh, user management).

**Rationale:** The abstraction costs almost nothing — it is a single interface with one method. It allows development to proceed with seeded identities while preserving the ability to select any OIDC-compliant provider when the first customer integration demands it.

---

### ADR-022: Role-Based Authorization with Explicit Permission Mapping

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Different users need different access levels within an organization.

**Decision:** Three roles (`organization_admin`, `operator`, `viewer`) stored as a string on `OrganizationMembership`. Authorization uses a centralized, explicit role-to-permission mapping. Route handlers check named permissions (e.g., `catalog:read`, `import:execute`), not role strings directly. Roles are never compared lexically, alphabetically, or ordinally.

**Alternatives considered:**
- **Direct role-string comparison in routes:** Simpler but scatters role knowledge across every route handler. Difficult to audit which routes allow which roles. Prone to errors when roles are added or renamed.
- **Database-backed permission tables:** Maximum flexibility but adds a permissions table, role-permission mapping table, and a runtime resolution query. Unjustified with 3 roles and 5 permissions.
- **Attribute-based access control (ABAC):** Policies evaluate attributes (role, resource type, time, location). Powerful but complex. Unjustified for current requirements.

**Rationale:** The centralized mapping provides a single source of truth for what each role can do. Routes check permissions by name, which is self-documenting and auditable. The mapping is a static object — no database lookups, no framework, no policy engine. Adding a new permission or role means updating one object and the route that checks it. If the number of permissions grows beyond what a static mapping can manage, upgrade to database-backed permissions at that point.

---

### ADR-023: Organization Configuration — Hybrid Typed + JSONB

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Organizations need configurable settings that vary by tenant. Options range from a column per setting to a single JSONB blob.

**Decision:** Typed columns for security-critical and structural settings (name, slug, status). Validated JSONB for operational settings (import limits, locale, display, features).

**Alternatives considered:**
- **Column per setting:** Type-safe and queryable but requires a migration for every new setting. Becomes unwieldy as settings grow.
- **Pure JSONB:** Maximum flexibility but loses type safety for critical settings. Cannot index or query structural fields efficiently. Allows arbitrary unvalidated data.
- **Separate settings table (key-value):** Flexible but loses type safety entirely and requires N queries to load N settings.

**Rationale:** The hybrid approach puts guardrails on critical settings (cannot accidentally nullify the org name) while providing flexibility for operational configuration that changes frequently. Server-side validation against a TypeScript type prevents arbitrary objects from entering the database.

---

### ADR-024: PostgreSQL RLS — Deferred

| | |
|---|---|
| **Status** | Deferred |
| **Date** | 2026-08-02 |

See Section 3 for the full evaluation. RLS will be implemented before multi-customer production deployments.

---

### ADR-025: Tenant-Isolated Blob Storage

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-02 |

**Context:** Uploaded files must be isolated per tenant. The current storage key format includes an org prefix by convention but the storage abstraction has no enforcement.

**Decision:** Enforce tenant-scoped storage keys through a wrapper that validates the org prefix on every operation. Use the key format `organizations/{orgId}/catalogs/{catalogId}/imports/{importId}/{filename}`.

**Alternatives considered:**
- **Container-per-tenant:** Maximum isolation but requires dynamic container creation, per-container access policies, and connection management. Azure Blob Storage supports 500+ containers per account, so this is viable at scale but unjustified now.
- **Convention only (current state):** Works when all code follows the convention, but a single omission or bug exposes cross-tenant data.

**Rationale:** A wrapper that enforces the prefix on every operation is simple, testable, and provides the same isolation guarantee as convention-based separation without depending on developer discipline. The storage interface does not change — the wrapper is transparent to callers.

---

## 10. Tenant-Isolation Test Requirements

**Status:** 23 integration tests implemented in `server/test/integration/tenant-isolation.test.ts`, plus 90 unit tests covering auth, config, and domain logic.

Tests use two organizations (Alpha and Beta) with users in each. `TestAuthProvider` maps specific tokens to different authenticated users. Tests require PostgreSQL (`describe.skipIf(!DATABASE_URL)`) and are run separately via `npm run test:integration`.

| # | Group | Test | Type |
|---|---|---|---|
| 1 | Authentication | Rejects requests without Authorization header | Integration |
| 2 | Authentication | Rejects requests with invalid token | Integration |
| 3 | Authentication | Accepts valid dev auth token | Integration |
| 4 | User identity | GET /me returns authenticated user | Integration |
| 5 | User identity | GET /me/organizations returns user memberships | Integration |
| 6 | Org selection | Auto-resolves single-org users | Integration |
| 7 | Org selection | Requires X-Organization-Id for multi-org users | Integration |
| 8 | Org selection | Rejects invalid X-Organization-Id | Integration |
| 9 | Cross-tenant | Cannot list other org's catalogs | Integration |
| 10 | Cross-tenant | Cannot access other org's catalog by UUID | Integration |
| 11 | Cross-tenant | Cannot access other org's products | Integration |
| 12 | Cross-tenant | Cannot access other org's organization details | Integration |
| 13 | Role-based | Viewer cannot create catalogs | Integration |
| 14 | Role-based | Viewer cannot modify organization settings | Integration |
| 15 | Role-based | Admin can create catalogs | Integration |
| 16 | Role-based | Operator can create catalogs | Integration |
| 17 | Audit logging | Auth failure creates audit log | Integration |
| 18 | Audit logging | Catalog creation creates audit log | Integration |
| 19 | Audit logging | Org settings update creates audit log | Integration |
| 20 | Audit logging | Authorization denial creates audit log | Integration |
| 21 | Catalog classification | Catalog created with default type 'test' | Integration |
| 22 | Catalog classification | Catalog supports explicit type | Integration |
| 23 | Request context | Response includes X-Request-Id | Integration |

**Fixture requirements:**
- 2 organizations (Alpha and Beta) with deterministic UUIDs
- 2 users: Alice (admin in Alpha + viewer in Beta, multi-org), Bob (operator in Beta, single-org)
- Cleanup deletes in FK-safe order: auditLog → catalog → membership → user → organization

---

## 11. Environment Variables

### 11.1 Production Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | — | Must be `production` in production |
| `AUTH_MODE` | Yes | — | `production` or `development`. Cannot be `development` when `NODE_ENV=production`. |
| `DEV_AUTH_TOKEN` | Dev only | — | Required when `AUTH_MODE=development`. The token `DevAuthProvider` validates against. |
| `AUTH_ISSUER` | Prod only | — | JWT issuer URL (e.g., `https://login.microsoftonline.com/{tenant}/v2.0`) |
| `AUTH_AUDIENCE` | Prod only | — | JWT audience claim (application client ID) |
| `AUTH_JWKS_URI` | Prod only | — | JWKS endpoint URL for public key retrieval |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | Yes | — | Comma-separated CORS origins. Wildcard `*` rejected in production. |
| `STORAGE_PROVIDER` | Yes | `local` | `azure` or `local` |
| `AZURE_STORAGE_CONNECTION_STRING` | If azure | — | Azure Blob Storage connection string |
| `AZURE_STORAGE_CONTAINER` | If azure | `imports` | Azure Blob container name |
| `LOCAL_STORAGE_PATH` | If local | `./uploads` | Local filesystem storage path |
| `PORT` | No | `3001` | Server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `MAX_UPLOAD_SIZE_MB` | No | `50` | Global maximum upload size |
| `MAX_IMPORT_ROWS` | No | `10000` | Global maximum import rows |
| `ALLOW_DEV_SEED` | Seed only | — | Must be `true` to run `db:seed`. Seed script also refuses `NODE_ENV=production` and validates DB host. |

### 11.1b Frontend Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_BASE_URL` | No | `/api/v1` | Backend API base URL |
| `VITE_DEV_AUTH_TOKEN` | Dev only | — | When set, frontend sends `Authorization: Bearer <token>`. No fallback when unset. |
| `VITE_FORCE_DEMO` | No | — | Set `true` to force demo mode |

### 11.2 Startup Validation

The application must **fail fast** at startup when:

1. `NODE_ENV=production` and `AUTH_MODE=development` → Error: "Development auth mode cannot be used in production"
2. `AUTH_MODE=production` and any of `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URI` is missing → Error: "Production auth requires AUTH_ISSUER, AUTH_AUDIENCE, and AUTH_JWKS_URI"
3. `STORAGE_PROVIDER=azure` and `AZURE_STORAGE_CONNECTION_STRING` is missing → Error: "Azure storage requires AZURE_STORAGE_CONNECTION_STRING"
4. `DATABASE_URL` is missing → Error: "DATABASE_URL is required"

Development and internal-test environments may use defaults for non-critical settings. Production must explicitly configure all required variables.

### 11.3 Removed Variables

| Variable | Replacement | Migration |
|---|---|---|
| `DEFAULT_ORG_ID` | Resolved from authenticated user's membership | Remove from config; remove from `.env.example` |
| `DEFAULT_USER` | Resolved from authenticated user's identity | Remove from config; remove from `.env.example` |

These variables exist only during the transition period (internal-test mode with `AUTH_MODE=development`). In production, they must not be present.

---

## 12. Production Readiness Classification

| Capability | Status | Notes | Blocker: Internal Test | Blocker: Customer Prod |
|---|---|---|---|---|
| Authentication | **Implemented** | `DevAuthProvider` with `DEV_AUTH_TOKEN`; `AuthProvider` interface ready for JWT provider | Done | **Yes** (wire JWT provider) |
| Organization model | **Implemented** | Prisma model with settings JSONB, slug, status | Done | Done |
| User model | **Implemented** | Prisma model with `external_identity_id` | Done | Done |
| Membership model | **Implemented** | Prisma model with role, unique `(org, user)` | Done | Done |
| Role authorization | **Implemented** | 3 roles, 5 permissions, centralized mapping | Done | Done |
| Tenant-scoped queries | **Implemented** | All routes filter by `tenantContext.organizationId` | Done | Done |
| Cross-tenant protection | **Implemented** | 23 integration tests verify isolation | Done | Done |
| TenantContext in services | **Implemented** | All service methods require `TenantContext` | Done | Done |
| Blob storage isolation | **Implemented** | `TenantScopedStorage` enforces org prefix with validation | Done | Done |
| Organization configuration | **Implemented** | `GET/PATCH /organization`, `GET /organization/members` | Done | Done |
| Active org selection | **Implemented** | `X-Organization-Id` header, `GET /me/organizations` | Done | Done |
| Tenant-isolation tests | **Implemented** | 23 integration + 90 unit tests | Done | Done |
| Startup validation | **Implemented** | Fail-fast for DATABASE_URL, DEV_AUTH_TOKEN, ALLOWED_ORIGINS, wildcard CORS, Azure storage | Done | Done |
| Audit logging | **Implemented** | Append-only `AuditLog` model: auth failures, catalog/import ops, org settings, authorization denials | Done | Done |
| Request correlation | **Implemented** | `X-Request-Id` propagated through request/response/logs | Done | Done |
| Catalog classification | **Implemented** | `catalog_type` field (test/production/sandbox/other), defaults to `test` | Done | Done |
| Seed script safety | **Implemented** | Refuses production, requires `ALLOW_DEV_SEED=true`, validates DB host | Done | Done |
| PostgreSQL RLS | Deferred | Application-layer enforcement sufficient for internal deployment | No | **Yes** (evaluate) |
| Rate limiting | Not implemented | Add before broader exposure | No | **Yes** |
| Backups | Not configured | Azure PostgreSQL PITR | No | **Yes** |
| Monitoring | Not implemented | Azure App Insights | No | **Yes** |
| Prisma tenant guard | Not implemented | Extension warns/throws on unscoped queries | No | **Yes** |

---

## 13. Implementation Sequence

All steps are complete. The sequence was executed as designed.

| Step | Description | Status |
|---|---|---|
| 1 | Audit (this document, Section 1) | **Complete** |
| 2 | Finalize architecture — stakeholder review | **Complete** |
| 3 | Add Organization, User, OrganizationMembership models | **Complete** — migration `20250802000000_add_multi_tenancy` |
| 4 | Add AuthProvider interface + development auth mode | **Complete** — `DEV_AUTH_TOKEN` validation |
| 5 | Add auth middleware to Fastify | **Complete** — `onRequest` hook with public/auth-only route classification |
| 6 | Introduce TenantContext in services | **Complete** — all services require `TenantContext` |
| 7 | Scope every query and mutation | **Complete** — all routes filter by `organizationId` |
| 8 | Add role authorization | **Complete** — `requirePermission()` with centralized role-permission map |
| 9 | Isolate blob storage | **Complete** — `TenantScopedStorage` with prefix enforcement |
| 10 | Add organization configuration | **Complete** — `GET/PATCH /organization`, `GET /organization/members` |
| 11 | Add /me and /me/organizations routes | **Complete** — user identity and membership listing |
| 12 | Write tenant-isolation tests | **Complete** — 23 integration test cases |
| 13 | Update documentation | **Complete** — all 6 architecture/deployment docs updated |
| 14 | Hardening — DEV_AUTH_TOKEN, audit logging, request correlation, catalog classification, seed safety, config fail-fast | **Complete** |
| 15 | Verification sweep and report | **In progress** |

---

## 14. Resolved Questions

1. **Foreign key from catalog/import_batch/canonical_product to organization** — Resolved: yes, FK constraints added in migration `20250802000000_add_multi_tenancy`. All `organization_id` columns reference the `organization` table with `ON DELETE RESTRICT`.

2. **Backfill strategy for existing data** — Resolved: seed script creates development org and user. Fresh databases use the seed; existing data must be manually backfilled or re-created.

3. **Frontend changes** — Resolved for development: frontend sends `Authorization: Bearer <VITE_DEV_AUTH_TOKEN>` when configured. Production login flow (JWT/OIDC) deferred to Phase 2.

4. **Organization slug uniqueness** — Resolved: unique constraint on `slug` in the Prisma schema. Seed script generates kebab-case slugs.

---

## Appendix A: Existing Organization ID Usage Map

For reference during implementation — every location in the codebase that currently references `organization_id`, `defaultOrgId`, or `defaultUser`:

| File | Line(s) | Usage | Action |
|---|---|---|---|
| `server/src/config.ts` | 27-28 | `defaultOrgId`, `defaultUser` declarations | Remove after migration |
| `server/src/routes/catalog.routes.ts` | 6, 30 | `app.config.defaultOrgId` for query/create | Replace with `request.tenantContext.organizationId` |
| `server/src/routes/catalog.routes.ts` | 19-20, 38-39 | `app.config.defaultUser` for created_by/updated_by | Replace with `request.tenantContext.displayName` |
| `server/src/routes/import.routes.ts` | 14 | `app.config.defaultOrgId` for import | Replace with `request.tenantContext.organizationId` |
| `server/src/services/import.service.ts` | 75 | `this.config.defaultUser` for uploadedBy | Replace with TenantContext |
| `server/src/services/import.service.ts` | 194 | `this.config.defaultUser` for updatedBy | Replace with TenantContext |
| `server/src/services/import.service.ts` | 268-269 | `this.config.defaultUser` for createdBy/updatedBy | Replace with TenantContext |
| `server/src/types.ts` | — | `AppConfig` type includes `defaultOrgId`, `defaultUser` | Remove fields |
| `server/.env` | — | `DEFAULT_ORG_ID`, `DEFAULT_USER` | Remove after migration |
| `server/.env.example` | — | `DEFAULT_ORG_ID`, `DEFAULT_USER` | Remove; add `AUTH_MODE` |
