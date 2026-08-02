# Backend Deployment Checklist

Production deployment readiness checklist for the Data Kitchen backend API.

**Status**: Pre-deployment  
**Last reviewed**: 2026-08-02  
**Backend stack**: Node.js + TypeScript 5.7 + Fastify 5 + Prisma 6 + PostgreSQL 16

---

## Architecture Decision

Azure Static Web Apps remains on the **Free plan**. The Fastify backend deploys to a separate Azure App Service. The frontend calls the App Service directly via HTTPS using a build-time `VITE_API_BASE_URL`. No SWA Linked Backend or bring-your-own API integration is used.

**Request flow:**

```
Browser
  ├── GET datakitchen.mirchilabs.com/*  →  Azure SWA (Free plan, static React app)
  └── GET/POST datakitchen-api.azurewebsites.net/api/v1/*  →  Azure App Service (Fastify)
                                                                  ├── PostgreSQL
                                                                  └── Azure Blob Storage
```

The browser sees **two separate origins**. CORS is handled by the Fastify backend — it is not proxied through SWA.

---

## Table of Contents

- [Part 1: Manual Azure Portal Steps](#part-1-manual-azure-portal-steps)
- [Part 2: GitHub Repository Configuration](#part-2-github-repository-configuration)
- [Part 3: Automated Deployment Steps](#part-3-automated-deployment-steps)
- [Part 4: Verification Steps](#part-4-verification-steps)
- [Security Implications](#security-implications)
- [Rollback Procedure](#rollback-procedure)
- [Known Limitations](#known-limitations)

---

## Part 1: Manual Azure Portal Steps

### 1.1 Azure App Service

| Setting | Value |
|---|---|
| **Resource name** | `datakitchen-api` (suggested) |
| **Resource group** | Same as the SWA (`icy-stone-00f10fb1e` resource group) |
| **Region** | Same region as the SWA for latency |
| **OS** | Linux |
| **Runtime stack** | Node 20 LTS |
| **Plan** | B1 minimum (S1 recommended for production) |
| **Always On** | Enabled (prevents cold starts; requires Basic tier or above) |

- [ ] Create the App Service
- [ ] Set **Startup Command** to `node dist/index.js`
- [ ] Enable **HTTPS Only**
- [ ] Note the default hostname (e.g. `datakitchen-api.azurewebsites.net`)

### 1.2 Azure Database for PostgreSQL Flexible Server

| Setting | Value |
|---|---|
| **Resource name** | `datakitchen-db` (suggested) |
| **Resource group** | Same as above |
| **Region** | Same region as the App Service |
| **PostgreSQL version** | 16 |
| **Tier** | Burstable B1ms (dev/test) or General Purpose D2ds_v5 (production) |
| **Storage** | 32 GB minimum, auto-grow enabled |
| **Authentication** | PostgreSQL authentication (username + password) |
| **Database name** | `datakitchen` |

- [ ] Create the PostgreSQL Flexible Server
- [ ] Create a database named `datakitchen`
- [ ] Allow networking from the App Service (add App Service outbound IPs to firewall rules, or use VNet integration)
- [ ] Record the connection string: `postgresql://<user>:<password>@<host>:5432/datakitchen?sslmode=require`
- [ ] Verify connectivity from App Service (Kudu console or SSH): `psql $DATABASE_URL -c "SELECT 1"`

### 1.3 Azure Blob Storage

| Setting | Value |
|---|---|
| **Resource name** | `datakitchenstorage` (suggested, must be globally unique, lowercase, no hyphens) |
| **Resource group** | Same as above |
| **Performance** | Standard |
| **Redundancy** | LRS (dev) or ZRS/GRS (production) |
| **Access tier** | Hot |

- [ ] Create the Storage Account
- [ ] The container `imports` will be auto-created on first upload (the code calls `createIfNotExists`)
- [ ] Record the **Connection String** from Access Keys blade
- [ ] Verify the container name matches `AZURE_STORAGE_CONTAINER` env var (default: `imports`)

### 1.4 Custom Domain (optional)

- [ ] Map `api.datakitchen.mirchilabs.com` to the App Service
- [ ] Configure SSL certificate (App Service Managed Certificate or custom)
- [ ] Update `ALLOWED_ORIGINS` to match the frontend origin

---

## Part 2: GitHub Repository Configuration

### 2.1 Required GitHub Actions Secrets

| Secret | Value | Purpose |
|---|---|---|
| `AZURE_CREDENTIALS` | Service principal JSON | `azure/login@v2` authentication for backend deploy |

To create the service principal:

```bash
az ad sp create-for-rbac \
  --name "datakitchen-deploy" \
  --role contributor \
  --scopes /subscriptions/<subscription-id>/resourceGroups/<resource-group> \
  --sdk-auth
```

- [ ] Create the service principal with Contributor role scoped to the resource group
- [ ] Add `AZURE_CREDENTIALS` as a repository secret

### 2.2 Required GitHub Actions Variables

| Variable | Value | Purpose |
|---|---|---|
| `AZURE_BACKEND_APP_NAME` | `datakitchen-api` | Target App Service name for `azure/webapps-deploy@v3` |
| `VITE_API_BASE_URL` | `https://datakitchen-api.azurewebsites.net/api/v1` | Frontend API base URL, baked into the SWA build |

The API hostname is not a secret — use a GitHub Actions **variable** (not a secret) so it is visible in workflow logs for debugging.

**Where it is consumed**: The SWA workflow (`.github/workflows/azure-static-web-apps-icy-stone-00f10fb1e.yml`) passes `VITE_API_BASE_URL` as an environment variable to the Vite build via the `env:` block on the "Build And Deploy" step. Vite replaces `import.meta.env.VITE_API_BASE_URL` at build time.

- [ ] Add `AZURE_BACKEND_APP_NAME` as a repository variable
- [ ] Add `VITE_API_BASE_URL` as a repository variable (format: `https://<app-service-hostname>/api/v1`)

### 2.3 Required App Service Application Settings

Configure in the App Service > **Configuration** > **Application Settings** blade:

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | **Yes** | `postgresql://<user>:<password>@<host>:5432/datakitchen?sslmode=require` |
| `NODE_ENV` | Yes | `production` |
| `STORAGE_PROVIDER` | Yes | `azure` |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes (when STORAGE_PROVIDER=azure) | Connection string from Storage Account |
| `AZURE_STORAGE_CONTAINER` | No | `imports` (default) |
| `PORT` | No | `8080` (Azure App Service convention; app defaults to 3001) |
| `HOST` | No | `0.0.0.0` (default) |
| `ALLOWED_ORIGINS` | Yes | `https://datakitchen.mirchilabs.com` |
| `AUTH_MODE` | Yes | `development` for internal test; `production` for customer deployment |
| `DEV_AUTH_TOKEN` | Yes (dev) | Token for `DevAuthProvider` — required when `AUTH_MODE=development` |
| `AUTH_ISSUER` | Yes (prod) | Auth provider issuer URL |
| `AUTH_AUDIENCE` | Yes (prod) | Auth provider audience |
| `AUTH_JWKS_URI` | Yes (prod) | Auth provider JWKS endpoint |
| `MAX_UPLOAD_SIZE_MB` | No | `50` (default) |
| `MAX_IMPORT_ROWS` | No | `10000` (default) |

**ALLOWED_ORIGINS** supports comma-separated values for multiple origins:
```
ALLOWED_ORIGINS=https://datakitchen.mirchilabs.com,https://staging.datakitchen.mirchilabs.com
```

In development, the default is `http://localhost:5173` (Vite dev server).

**Important**: Azure App Service for Node.js on Linux expects the app to listen on `PORT` (defaults to `8080`). Either set `PORT=8080` in Application Settings, or verify Azure sets it automatically.

- [ ] Set all required Application Settings
- [ ] Verify `DATABASE_URL` contains `?sslmode=require` for Azure PostgreSQL
- [ ] Verify `ALLOWED_ORIGINS` matches the exact frontend origin (no trailing slash, no wildcard)

---

## Part 3: Automated Deployment Steps

### 3.1 Frontend CI/CD (SWA Workflow)

The workflow at `.github/workflows/azure-static-web-apps-icy-stone-00f10fb1e.yml` triggers on push to `main`:

```
push to main → checkout → OIDC token → Oryx build (npm run build) → deploy dist/
```

The `VITE_API_BASE_URL` variable is passed to the build step as an environment variable. Vite inlines it into the production bundle at build time. If the variable is not set, the frontend falls back to `/api/v1` (useful for local development where the Vite proxy handles routing).

**No SWA Standard plan features are used.** The SWA Free plan provides:
- Static file hosting from `dist/`
- SPA navigation fallback (`/index.html`)
- Custom domain with SSL
- GitHub Actions integration

### 3.2 Backend CI/CD Workflow

The workflow at `.github/workflows/backend-deploy.yml` triggers on push to `main` when `server/**` changes:

```
push to main (server/**) → test job → deploy job
```

**Test job** (runs on every push and PR):
1. Checkout code
2. Setup Node.js 20
3. `npm ci` (in `server/`)
4. `npx prisma generate`
5. `npm test` (90 unit tests via Vitest)

**Deploy job** (runs only on push to main, after test passes):
1. Checkout code
2. Setup Node.js 20
3. `npm ci` (in `server/`)
4. `npx prisma generate`
5. `npm run build` (runs `tsc`, outputs to `server/dist/`)
6. `azure/login@v2` with `AZURE_CREDENTIALS`
7. `azure/webapps-deploy@v3` deploys `server/` to App Service

### 3.3 What the Workflows Do NOT Do

- Database migrations are not run automatically. See [Prisma Migration Procedure](#41-prisma-migration-procedure).
- The backend workflow does not set Application Settings — those must be pre-configured in the Azure Portal.

---

## Part 4: Verification Steps

### 4.1 Prisma Migration Procedure

Run once during initial deployment, and again for each new migration:

```bash
# From the App Service SSH console (Kudu) or a CI step:
cd /home/site/wwwroot
npx prisma migrate deploy
```

This applies all pending migrations from `server/prisma/migrations/`. There are currently three migrations:

| Migration | Tables/Changes |
|---|---|
| `00000000000000_init` | `catalog`, `import_batch`, `canonical_product`, `source_record`, `canonical_product_history`, `field_provenance` + 10 indexes, partial unique index on `(catalog_id, sku)`, 6 FK constraints |
| `20250802000000_add_multi_tenancy` | `organization`, `user`, `organization_membership` + FK constraints (all RESTRICT), unique constraints on slug/email/external_identity_id |
| `20250802010000_add_audit_log_and_catalog_type` | `audit_log` table (FK to organization ON DELETE SET NULL), `catalog_type` column on `catalog` (default `'test'`), backfill existing catalogs |

Verify migration succeeded:

```bash
npx prisma migrate status
```

Expected output: `Database schema is up to date!`

**Alternative**: Add a migration step to the deploy workflow (before `webapps-deploy`):

```yaml
- name: Run migrations
  run: npx prisma migrate deploy
  working-directory: server
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### 4.2 Health Check Verification

```bash
curl -s https://<backend-host>/api/v1/health | jq
```

Expected response (200 OK):

```json
{
  "status": "ok",
  "timestamp": "2026-08-02T21:00:00.000Z",
  "database": "connected"
}
```

If database is unreachable (503):

```json
{
  "status": "degraded",
  "timestamp": "2026-08-02T21:00:00.000Z",
  "database": "disconnected"
}
```

- [ ] Health check returns `status: "ok"` with `database: "connected"`
- [ ] Response content-type is `application/json`
- [ ] Configure App Service health check probe to `GET /api/v1/health`

### 4.3 CORS Verification

Since the frontend and backend are on different origins, the browser will send CORS preflight requests.

```bash
curl -s -I -X OPTIONS \
  -H "Origin: https://datakitchen.mirchilabs.com" \
  -H "Access-Control-Request-Method: POST" \
  https://<backend-host>/api/v1/health
```

- [ ] Response includes `Access-Control-Allow-Origin: https://datakitchen.mirchilabs.com`
- [ ] Response includes `Access-Control-Allow-Methods` with `GET, POST`
- [ ] Preflight does NOT return `Access-Control-Allow-Origin: *`
- [ ] Requests from unlisted origins are rejected

### 4.4 Frontend Live Mode Verification

After the backend is deployed and `VITE_API_BASE_URL` is set in the SWA build:

1. Open `https://datakitchen.mirchilabs.com/intake`
2. Open Browser DevTools > Network tab
3. Verify the health check request goes to `https://datakitchen-api.azurewebsites.net/api/v1/health`
4. The "demo" badge should disappear (health check passes, app switches to live mode)
5. The product table should show live data from PostgreSQL (initially empty)
6. The catalog list should auto-create a "Default Catalog"

- [ ] Health check request targets the App Service origin (not the SWA origin)
- [ ] No CORS errors in the browser console
- [ ] Frontend switches from demo mode to live mode
- [ ] No "demo" badge visible
- [ ] Empty product table with correct column headers

### 4.5 First Production Import Test

Prepare a small test CSV (3-5 rows):

```csv
sku,product_name,brand,category,gtin
TEST-001,Test Product One,TestBrand,Electronics,00012345678901
TEST-002,Test Product Two,TestBrand,Home & Kitchen,00098765432109
TEST-003,Test Product Three,TestBrand,Garden,
```

Test procedure:

1. [ ] Click "Import Data" on the Catalog Workspace page
2. [ ] Upload the test CSV
3. [ ] Verify preview shows 3 rows with auto-suggested field mappings
4. [ ] Confirm the import
5. [ ] Verify results: 3 products created, 0 updated, 0 failed
6. [ ] Verify products appear in the product table
7. [ ] Verify product with SKU `TEST-003` shows "Missing Fields" quality status (no GTIN)
8. [ ] Verify products with full data show "Complete" quality status
9. [ ] Check Import History shows the completed import
10. [ ] Re-upload the same CSV — verify products are UPDATED (not duplicated)
11. [ ] Verify Import History shows 2 imports, second shows "updated" counts

### 4.6 Storage Verification

```bash
# From Azure Portal or CLI, verify the blob container was created:
az storage container list \
  --account-name <storage-account-name> \
  --query "[?name=='imports']"

# Verify the uploaded file exists:
az storage blob list \
  --account-name <storage-account-name> \
  --container-name imports \
  --query "[].name"
```

- [ ] Container `imports` exists
- [ ] Uploaded CSV file is stored as a blob
- [ ] Blob key follows the pattern: `<org-id>/<catalog-id>/<timestamp>-<filename>`

### 4.7 Logging and Error Diagnostics

Fastify logs at `info` level in production and `debug` in development. Logs write to stdout, which Azure App Service captures automatically.

**View logs:**
- Azure Portal: App Service > **Log stream** (real-time)
- Azure Portal: App Service > **Diagnose and solve problems**
- CLI: `az webapp log tail --name datakitchen-api --resource-group <rg>`

**Enable diagnostic logging:**
- [ ] App Service > **Monitoring** > **App Service logs**
- [ ] Enable **Application Logging (Filesystem)** — set to `Information` level
- [ ] Enable **Detailed error messages** for 4xx/5xx diagnostics
- [ ] Optionally enable **Application Insights** for APM

**Key log patterns to monitor:**
- `Server listening on 0.0.0.0:<port>` — successful startup
- `error` level entries — unhandled errors or DB connection failures
- 413 responses — file size limit exceeded
- 503 on `/health` — database connectivity lost

### 4.8 Post-Deployment Validation Checklist

| Check | Command/Action | Expected |
|---|---|---|
| App Service running | Azure Portal > Overview | Status: Running |
| Health endpoint | `curl <backend>/api/v1/health` | `{"status":"ok","database":"connected"}` |
| CORS preflight | `OPTIONS <backend>/api/v1/health` with Origin header | `Access-Control-Allow-Origin` present |
| Migrations applied | `npx prisma migrate status` | `Database schema is up to date!` |
| Tables created | `SELECT count(*) FROM catalog` | `0` (error-free query) |
| Blob container | Azure Portal > Storage > Containers | `imports` container exists (after first upload) |
| Frontend API target | Browser DevTools > Network | Requests go to App Service origin |
| Frontend live mode | Open `/intake` in browser | No "demo" badge |
| Import flow | Upload test CSV | Products created in DB |
| Error handling | Upload invalid file (e.g. `.exe`) | 400 with clear error message |
| Demo fallback | Set `VITE_FORCE_DEMO=true`, rebuild | "demo" badge, seeded data |

---

## Security Implications

### Public API Endpoint

With this architecture the App Service endpoint (`datakitchen-api.azurewebsites.net`) is publicly reachable on the internet. Anyone — not just the Data Kitchen frontend — can call the API.

**CORS is not an authentication mechanism.** CORS prevents browser-based JavaScript on unauthorized origins from reading responses, but it does not prevent:
- Direct API calls from `curl`, Postman, scripts, or non-browser clients
- Server-to-server requests from any origin
- Automated data scraping or abuse

### Current Mitigations (internal deployment)

- **Authentication**: All API routes (except `/health`) require a valid Bearer token. `DevAuthProvider` validates against `DEV_AUTH_TOKEN` in development mode.
- **Authorization**: Role-based access control with 3 roles and 5 permissions. All queries scoped by `organizationId`.
- **Tenant isolation**: Every request resolves a `TenantContext` from the user's membership. Cross-tenant access returns 404.
- **Audit logging**: Append-only `AuditLog` records auth failures, catalog/import operations, org settings changes, and authorization denials.
- **Request correlation**: `X-Request-Id` header propagated through requests, responses, and structured logs.
- **Config fail-fast**: Production startup fails on missing DATABASE_URL, ALLOWED_ORIGINS, wildcard CORS, or missing auth config.
- **No write amplification**: import operations bounded by `MAX_IMPORT_ROWS` (10,000) and `MAX_UPLOAD_SIZE_MB` (50)
- **CORS scoping**: browser-based cross-origin requests restricted to listed origins; wildcard `*` rejected in production
- **HTTPS only**: App Service enforces TLS for transport security

### Required Before Customer Production Use

Before storing real customer data or exposing the API beyond the Mirchi Labs team:

1. **Production authentication**: Wire a JWT-validating `AuthProvider` (Entra ID, Auth0, etc.) via `AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_JWKS_URI`
2. **Rate limiting**: Add `@fastify/rate-limit` or Azure API Management
3. **Network restrictions** (optional): Use App Service access restrictions, VNet integration, or Azure Private Endpoints
4. **PostgreSQL RLS**: Evaluate as defense-in-depth for multi-tenant isolation
5. **Automated backups**: Configure Azure PostgreSQL Point-in-Time Restore

---

## Rollback Procedure

### Application Rollback

```bash
# List recent deployments
az webapp deployment list --name datakitchen-api --resource-group <rg>

# Redeploy a previous commit via GitHub Actions
# Re-run a previous successful workflow run from GitHub Actions UI
```

Alternatively, use deployment slots (requires Standard tier or above):
1. Create a staging slot
2. Deploy to staging first
3. Swap staging → production after verification
4. Swap back if issues arise

### Database Rollback

Prisma does not auto-rollback migrations. If a migration fails mid-apply:

1. Check `prisma migrate status` for the failed migration
2. Manually reverse the changes in PostgreSQL
3. Mark the migration as rolled back: `prisma migrate resolve --rolled-back <migration-name>`

For data issues (not schema):
- Azure PostgreSQL supports **Point-in-Time Restore** (PITR) with 7-35 day retention
- Create a new server restored to a specific point in time
- Migrate data from the restored server

### Emergency: Revert to Demo Mode

If the backend is down and the frontend must remain functional:
- The frontend automatically falls back to demo mode when the health check fails or returns non-JSON
- No action required — demo mode is the default fallback
- To force demo mode: add `VITE_FORCE_DEMO=true` to the SWA build environment

---

## Known Limitations

### Authentication Provider Not Yet Selected

The backend has a provider-neutral `AuthProvider` interface. `DevAuthProvider` validates against a configured `DEV_AUTH_TOKEN` in development mode. A production JWT-validating provider must be wired in before customer deployment. `AUTH_MODE=development` is blocked when `NODE_ENV=production`. `DEV_AUTH_TOKEN` is required when `AUTH_MODE=development`.

### No PostgreSQL RLS

Multi-tenancy is enforced at the application layer (all queries filter by `TenantContext.organizationId`). 23 integration tests verify tenant isolation. PostgreSQL row-level security is deferred as defense-in-depth. See `MULTI_TENANCY.md` for the deferral rationale.

### No Rate Limiting

No request rate limiting is configured. Add `@fastify/rate-limit` or Azure API Management before broader exposure.

### Synchronous Import

The import pipeline (`confirmImport`) processes all rows in a single request. For large files (5000+ rows), this may exceed the Azure request timeout (230 seconds) or hold transactions open too long. Background job queue is a Phase 3 roadmap item.

### No Automated Migration in CI/CD

The deploy workflow does not run `prisma migrate deploy`. Migrations must be run manually via SSH/Kudu or added as an explicit workflow step with a `DATABASE_URL` secret.

### SWA Free Plan Constraints

The Free plan provides 100 GB bandwidth/month and 2 custom domains. These are sufficient for the current prototype. If bandwidth or domain limits are reached, the SWA plan can be upgraded independently without affecting the backend architecture.

---

## Environment Variable Summary

### Frontend (build-time, via SWA workflow)

| Variable | Default | Production |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | `https://<app-service>.azurewebsites.net/api/v1` |
| `VITE_DEV_AUTH_TOKEN` | (unset) | (unset in production; set for internal test deployments) |
| `VITE_FORCE_DEMO` | (unset) | (unset; set `true` to force demo mode) |

### Backend (runtime, via App Service Application Settings)

| Variable | Required | Default | Production |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | `postgresql://...?sslmode=require` |
| `NODE_ENV` | No | `development` | `production` |
| `STORAGE_PROVIDER` | No | `local` | `azure` |
| `AZURE_STORAGE_CONNECTION_STRING` | When azure | — | Connection string |
| `AZURE_STORAGE_CONTAINER` | No | `imports` | `imports` |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | `https://datakitchen.mirchilabs.com` |
| `PORT` | No | `3001` | `8080` (Azure convention) |
| `HOST` | No | `0.0.0.0` | `0.0.0.0` |
| `AUTH_MODE` | No | `development` | `production` |
| `DEV_AUTH_TOKEN` | When dev auth | — | (not used in production) |
| `AUTH_ISSUER` | When prod auth | — | Auth provider URL |
| `AUTH_AUDIENCE` | When prod auth | — | Auth audience |
| `AUTH_JWKS_URI` | When prod auth | — | JWKS endpoint |
| `MAX_UPLOAD_SIZE_MB` | No | `50` | `50` |
| `MAX_IMPORT_ROWS` | No | `10000` | `10000` |

### GitHub Actions

| Type | Name | Value |
|---|---|---|
| Secret | `AZURE_CREDENTIALS` | Service principal JSON |
| Secret | `AZURE_STATIC_WEB_APPS_API_TOKEN_ICY_STONE_00F10FB1E` | SWA deploy token (existing) |
| Variable | `AZURE_BACKEND_APP_NAME` | App Service name |
| Variable | `VITE_API_BASE_URL` | `https://<app-service>.azurewebsites.net/api/v1` |
