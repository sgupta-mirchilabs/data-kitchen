# Azure Infrastructure — Internal Development Environment

> **Last updated:** 2026-08-02
> **Environment:** Development (internal Mirchi Labs use only)
> **Authors:** Sudu Gupta (Mirchi Labs)
> **Status:** CORRECTED — App Service B1 approved; awaiting approval of the corrections in Sections 9.2, 9.5, 11, and 12 before provisioning
> **Companion documents:** [BACKEND_DEPLOYMENT_CHECKLIST.md](./BACKEND_DEPLOYMENT_CHECKLIST.md), [MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md)

---

## Provisioned Values (as-built)

Provisioned 2026-08-02/03. Secrets are held only in App Service Application Settings and are not recorded here.

| Item | Value |
|---|---|
| Subscription type | Pay-As-You-Go (`PayAsYouGo_2014-09-01`), spending limit off |
| **Free-service benefit** | **Not applicable** — free-account PostgreSQL benefit requires an Azure free account (`MS-AZR-0044P`). No VS/Startups/Partner credits on this subscription. |
| Region | West US 3 |
| Resource group | `datakitchen-dev-rg` |
| App Service Plan | `datakitchen-dev-plan` — B1 Linux, capacity 1, no autoscale |
| App Service | `datakitchen-api-dev` → `datakitchen-api-dev.azurewebsites.net` |
| App Service runtime | **`NODE:22-lts`** — Node 20 is no longer offered on App Service Linux (EOL April 2026) |
| PostgreSQL | `datakitchen-db-dev` — Flexible Server 16, Standard_B1ms, 32 GB, autogrow disabled, 7-day backup |
| PostgreSQL networking | `publicNetworkAccess: Enabled`, deny-by-default (explicit per-IP rules only) |
| PostgreSQL TLS | `require_secure_transport = ON` |
| Database | `datakitchen` |
| Storage Account | `datakitchenstordev` — Standard LRS, blob public access disabled, min TLS 1.2 |
| Blob container | `imports` — private (`--public-access off`) |
| Log Analytics | `datakitchen-logs-dev` |
| Application Insights | `datakitchen-insights-dev` — workspace-based |
| Entra API registration | `data-kitchen-api-dev`, `api://<api-client-id>`, scope `access_as_user`, token version 2 |
| Entra SPA registration | `data-kitchen-web-dev`, SPA platform, PKCE, delegated `access_as_user` |
| Static Web App | `data-kitchen` (`icy-stone-00f10fb1e.7.azurestaticapps.net`), Free — pre-existing in `mirchi-data-kitchen` / West US 2 |

### Deployment packaging notes (learned during provisioning)

The App Service deployment failed twice before succeeding. Both causes are non-obvious and worth recording:

1. **Basic publishing credentials are disabled** (`basicPublishingCredentialsPolicies/scm.allow = false`), which is the secure default and was left as-is. `az webapp deploy` and any Kudu call using username/password will fail. Use a bearer token instead:
   ```bash
   TOK=$(az account get-access-token --resource https://management.core.windows.net/ --query accessToken -o tsv)
   curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/zip" \
     --data-binary @backend.zip \
     "https://datakitchen-api-dev.scm.azurewebsites.net/api/zipdeploy?isAsync=false"
   ```
2. **Oryx runs `npm run build` whenever a `build` script exists.** The deployed package ships a prebuilt `dist/` without `src/` or `tsconfig.json`, so `tsc` printed its help text and exited non-zero — reported only as `Deployment Failed` with `Errors (0)` in the summary. The fix is to omit the `build` script (and the test scripts) from the **shipped** `package.json`; the repository copy is unchanged. The real error is only visible in the Oryx detail log, reachable via the `details_url` on the `Running oryx build...` entry of `/api/deployments/<id>/log`.
3. **Zip archives must use POSIX separators.** PowerShell `Compress-Archive` writes `\` separators that Kudu cannot extract. Build the archive with Python's `zipfile` (or `zip`) and set mode `0o755` on `startup.sh`.
4. `prisma` was moved from `devDependencies` to `dependencies` because `startup.sh` invokes the Prisma CLI at container start, after a production-only install.

**Known deviations from the approved plan:**

1. **Node 22 instead of Node 20** — Azure App Service Linux offers only `NODE:22-lts` and `NODE:24-lts`. Node 22 is the nearest supported LTS.
2. **`--public-access None` required correction** — see the note in 9.2.1.
3. **Admin consent not granted** — the provisioning account holds subscription Owner but no Entra directory role, so tenant-wide admin consent was refused (`Authorization_RequestDenied`). The `access_as_user` scope is registered with user-consent enabled, so each Mirchi Labs user consents individually at first sign-in. A Global Administrator or Cloud Application Administrator can grant admin consent to remove the prompt.
4. **Frontend and backend live in different resource groups and regions** — the pre-existing SWA is in `mirchi-data-kitchen` / West US 2; backend resources are in `datakitchen-dev-rg` / West US 3. The SPA is CDN-served and reaches the API over HTTPS with CORS, so the split has no functional impact.

---

## Purpose

This document defines the Azure infrastructure for the Data Kitchen internal development environment. This is NOT a customer production environment. It supports:

- Internal Mirchi Labs team testing
- Microsoft Entra ID authentication (organizational accounts only)
- Full import pipeline (CSV/JSON → canonical products)
- Multi-tenant isolation verification
- CI/CD from GitHub Actions

---

## 1. Authentication Decision: Microsoft Entra ID

*Approved.* See full evaluation in prior revision. Summary:

- **Approach:** MSAL + JWT validation (Option A)
- **Frontend:** `@azure/msal-browser` / `@azure/msal-react` with single-tenant authority
- **Backend:** `jose` library validates JWT against Entra ID JWKS endpoint; implements existing `AuthProvider` interface
- **Cost:** $0 (Entra ID app registrations and sign-in are free)
- **SWA plan:** Free (MSAL handles tenant restriction in code; SWA built-in auth not used)
- **`VITE_DEV_AUTH_TOKEN`:** NOT baked into any cloud frontend bundle. Restricted to local dev and integration tests.
- **`DEV_AUTH_TOKEN`:** NOT used in the cloud environment. `AUTH_MODE=entra` in cloud; `AUTH_MODE=development` only for local.

---

## 2. Backend Compute Decision: Container Apps vs App Service B1

### Architecture Comparison

| Dimension | Option A: Container Apps Consumption | Option B: App Service B1 |
|---|---|---|
| **Service** | Azure Container Apps (Consumption plan) | Azure App Service (B1 Linux) |
| **Compute model** | Serverless; per-request billing; scale-to-zero | Fixed VM; $12.41/month regardless of usage |
| **CPU / Memory** | 0.5 vCPU / 1.0 GiB (configurable) | 1 core / 1.75 GB (fixed) |
| **Always warm** | Only with `minReplicas: 1` | Yes (Always On enabled) |
| **Cold start** | 15-30 seconds from zero (image pull + app init + Prisma connect) | None (Always On) |
| **Max request timeout** | 240 seconds | 230 seconds |
| **HTTPS ingress** | Built-in Envoy proxy, auto TLS, custom domains | Built-in, auto TLS, custom domains |
| **Deployment artifact** | Docker image (requires Dockerfile + registry) | Zip deploy (no container needed) |
| **Container registry** | ghcr.io (free for <500 MB private) or ACR Basic ($5/month) | Not needed |
| **App Insights** | No auto-instrumentation; requires OpenTelemetry SDK (~30 lines + dependency) | Auto-instrumentation via portal blade (zero code) |
| **Database migrations** | Container Apps Job (manual trigger) | Startup command runs `prisma migrate deploy` inside the app container (see Section 11) |
| **Debugging** | Log stream via CLI/portal; no SSH/Kudu console | Kudu console, SSH, log stream, App Service diagnostics |
| **Prisma connection pool** | Created on cold start; torn down on scale-to-zero; re-established on next request | Stable; pool stays warm indefinitely |
| **Health check with scale-to-zero** | Probes not sent when scaled to zero; first HTTP request triggers cold start; request is buffered during startup | Health check always responsive |
| **Frontend health check impact** | 3-second timeout in `api-client.ts` will fail during cold start → frontend shows demo mode | Always passes; frontend enters live mode immediately |
| **Synchronous import reliability** | Reliable within 240s timeout; 0.5 vCPU processes imports slower than 1 core | Reliable within 230s timeout; 1 core processes imports at full speed |
| **Free monthly grant** | 180,000 vCPU-seconds + 360,000 GiB-seconds + 2M requests | None |

### Can the Fastify Application Run Unchanged in a Container?

Yes. The application requires:

- Node.js 20, `dist/index.js` entry point, `PORT` environment variable
- Prisma client (generated at build time, includes platform-specific engine binary)
- SIGTERM/SIGINT handlers for graceful shutdown (already implemented in `server/src/index.ts`)

One code-level concern: Prisma's connection pool is created lazily on first query or explicit `$connect()`. The existing code calls `await prisma.$connect()` at startup and `await prisma.$disconnect()` on shutdown signals. This pattern is correct for containers. Connection pool settings should include `connection_limit=5&pool_timeout=20&connect_timeout=10` in the `DATABASE_URL` to avoid exhausting PostgreSQL connections across container restarts.

### Dockerfile Required

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci && npx prisma generate

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
USER appuser
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
CMD ["node", "dist/index.js"]
```

Estimated image size: ~180-220 MB compressed. Stored on ghcr.io (GitHub Container Registry).

### Container Registry

| Registry | Cost | Authentication | Notes |
|---|---|---|---|
| **ghcr.io (GitHub)** | $0 (500 MB private storage on GitHub Free) | `GITHUB_TOKEN` for push; PAT with `read:packages` for ACA pull | Sufficient for a single ~200 MB image |
| ACR Basic | $5.00/month | Managed identity or admin credentials | 10 GB included; not needed if ghcr.io suffices |

**Recommendation:** Use ghcr.io. No additional cost. The GitHub Actions workflow already has `GITHUB_TOKEN` for pushing images. Configure a PAT with `read:packages` scope as a Container Apps secret for pulling.

### Migration Execution

| Approach | Container Apps | App Service |
|---|---|---|
| **Recommended** | Container Apps Job (manual trigger from CI) | Startup command (`startup.sh`) — see Section 11 |
| **How it works** | `az containerapp job start` runs `prisma migrate deploy` in a short-lived container with `DATABASE_URL` | `prisma migrate deploy` runs inside the app container at startup, before Fastify binds the port |
| **Database access** | Runs in the Container Apps environment; needs its own firewall allowance | Runs from the App Service, whose outbound IPs are already allowed |
| **CI holds DB credentials?** | No | No |
| **Complexity** | Requires creating a Container Apps Job resource + configuring it in CI | One committed script + two App Service settings; no CI changes |

### Cold Start: Impact on Frontend Health Check

The frontend's `healthCheck()` in `src/lib/api-client.ts` uses a 3-second `AbortSignal.timeout`. With Container Apps at `minReplicas: 0`:

1. User opens the SPA
2. SPA calls `healthCheck()` → request goes to Container Apps ingress
3. Container is at zero replicas → cold start begins (15-30 seconds)
4. `AbortSignal.timeout(3000)` fires after 3 seconds → health check returns `false`
5. Frontend enters **demo mode** instead of live mode
6. User must reload the page after the container finishes starting

**Mitigations if Container Apps with minReplicas: 0 is chosen:**

- Increase `AbortSignal.timeout` to 35 seconds and show a "Connecting to server..." loading state (requires frontend code change)
- Or set `minReplicas: 1` to eliminate cold starts (increases cost from $0 to ~$10/month)
- Or accept the demo-mode fallback behavior for internal use

### Application Insights Integration

| Aspect | Container Apps | App Service |
|---|---|---|
| Auto-instrumentation | **Not supported.** Container Apps does not inject the App Insights agent. | **Supported.** Enable via App Service portal blade; zero code changes. |
| Manual instrumentation | Install OpenTelemetry SDK (`@azure/monitor-opentelemetry`). Configure at environment level via `az containerapp env telemetry app-insights set`. | Not needed (auto-instrumentation covers standard telemetry). |
| What you get automatically | Container stdout/stderr logs (Log Analytics), scaling events, platform metrics (CPU, memory) | Full APM: request/dependency/exception tracking, live metrics, application map, distributed tracing |
| Additional code for parity | ~30 lines of OpenTelemetry setup + `@azure/monitor-opentelemetry` dependency | None |

### GitHub Actions CI/CD Changes

**App Service (current plan):**

```
checkout → npm ci → prisma generate → npm run build →
az webapp deploy → (App Service startup command applies migrations) → health check
```

The migration step is deliberately absent from CI — it runs on the App Service. See Section 11.

**Container Apps (if chosen):**

```
checkout → docker build → docker push ghcr.io/... →
az containerapp job start (migrate) →
az containerapp update --image ghcr.io/...:sha → health check
```

The Container Apps workflow requires Docker build (~1-2 min), image push, and two `az` commands instead of one. Total CI time increases by ~2-3 minutes.

---

## 3. PostgreSQL Free-Benefit Eligibility

The Azure free account includes a 12-month benefit for PostgreSQL Flexible Server:

- **750 hours/month** of Burstable B1ms compute (covers a single server running 24/7: 730 hours/month)
- **32 GB** of provisioned storage
- **32 GB** of backup storage
- Benefit is **per-account**, not per-subscription

### How to Verify Eligibility

**Do not expose subscription or billing details in repository files.** The following steps are for the account administrator to perform in the Azure portal.

**Step 1 — Check subscription type:**

1. Azure portal → search **Subscriptions** → select the subscription
2. On the Overview page, check the **Offer ID**
3. If the Offer ID is **MS-AZR-0044P**, the subscription is an Azure free account

**Step 2 — Check free-service usage:**

1. Azure portal → **Subscriptions** → select the free-account subscription
2. On the Overview page, look for the **"Top free services by usage"** tile
3. If this tile exists, free-account benefits are active
4. Select **"View all free services"** to see the full table
5. Confirm **Azure Database for PostgreSQL** meters are listed
6. Hover over the tooltip at the **top left of the grid** to see when benefits expire

**Step 3 — When creating the PostgreSQL server:**

1. Select **Workload type: Development** (defaults to Burstable tier)
2. Configure server: **Burstable B1ms** (Standard_B1ms)
3. Storage: **32 GB** (do not exceed)
4. **Disable Storage autogrow** (prevents exceeding the free limit)
5. The portal may show an estimated cost — it will not be charged within free limits

### Other Credit Types to Check

| Credit Type | Monthly Value | How to Check |
|---|---|---|
| Visual Studio Enterprise | $150/month Azure credits | Azure portal → Cost Management + Billing → billing scope for VS subscription |
| Visual Studio Professional | $50/month Azure credits | Same as above |
| Microsoft for Startups (Founders Hub) | $1,000-$150,000 one-time | [foundershub.startups.microsoft.com](https://foundershub.startups.microsoft.com) → Benefits → Azure sponsorship |
| Microsoft Partner Network | $700-$10,000 depending on tier | [partner.microsoft.com](https://partner.microsoft.com) → Benefits → Azure credits |
| Azure Sponsorship | Varies | Azure portal → Cost Management + Billing → Payment methods → Azure credits tab |

Credits from any of these sources cover PostgreSQL Flexible Server costs ($16.09/month).

### Important Caveats

- Free quantities **do not roll over** between months
- A **stopped** PostgreSQL server still incurs storage charges (compute stops, storage does not)
- After the 12-month period expires, billing begins automatically at pay-as-you-go rates
- Only **one free account** per eligible customer
- Running **two** B1ms servers simultaneously would exceed the 750-hour limit

---

## 4. Cost Scenarios

All prices verified against the Azure Retail Prices API (August 2026) for West US 3.

### Usage Assumptions

| Metric | Estimate | Rationale |
|---|---|---|
| Users | <10 Mirchi Labs employees | Internal dev only |
| Usage pattern | Sporadic; ~20 interactive sessions/month | Not continuous |
| Imports | <100/month, most <10,000 rows | Early-stage testing |
| Active container time (scale-to-zero) | ~200 minutes/month | 20 sessions × ~10 min (5 min active + 5 min cooldown) |
| API requests | ~5,000/month | Well under 2M free grant |
| Blob storage | <1 GB | Minimal test data |
| App Insights ingestion | <1 GB/month | Well under 5 GB free tier |
| Egress bandwidth | <5 GB/month | Within free tier |

### Scenario Comparison

| Line Item | Scenario 1 | Scenario 2 | Scenario 3 | Scenario 4 |
|---|---|---|---|---|
| | **Container Apps (min 0) + free PG** | **Container Apps (min 0) + paid PG** | **App Service B1 + free PG** | **App Service B1 + paid PG** |
| Backend compute | $0.00 | $0.00 | $12.41 | $12.41 |
| PostgreSQL compute | $0.00 | $12.41 | $0.00 | $12.41 |
| PostgreSQL storage (32 GB) | $0.00 | $3.68 | $0.00 | $3.68 |
| PostgreSQL backup (32 GB) | $0.00 | $0.00 | $0.00 | $0.00 |
| Blob Storage (LRS, <1 GB) | $0.50 | $0.50 | $0.50 | $0.50 |
| Application Insights | $0.00 | $0.00 | $0.00 | $0.00 |
| Container registry (ghcr.io) | $0.00 | $0.00 | — | — |
| Egress bandwidth (<5 GB) | $0.00 | $0.00 | $0.00 | $0.00 |
| Entra ID | $0.00 | $0.00 | $0.00 | $0.00 |
| SWA Free | $0.00 | $0.00 | $0.00 | $0.00 |
| **Total** | **~$0.50/month** | **~$16.59/month** | **~$12.91/month** | **~$29.00/month** |

### How Container Apps Compute Costs Were Calculated

**Scale-to-zero (minReplicas: 0) at 0.5 vCPU / 1.0 GiB:**

| Meter | Seconds/month | Resource | Total | Free Grant | Billable | Rate | Cost |
|---|---|---|---|---|---|---|---|
| Active vCPU | ~7,000 | ×0.5 | 3,500 | 180,000 | 0 | $0.000024/s | $0.00 |
| Active memory | ~7,000 | ×1.0 | 7,000 | 360,000 | 0 | $0.000003/s | $0.00 |
| Idle vCPU (cooldown) | ~5,000 | ×0.5 | 2,500 | (included above) | 0 | $0.000003/s | $0.00 |
| Idle memory (cooldown) | ~5,000 | ×1.0 | 5,000 | (included above) | 0 | $0.000003/s | $0.00 |
| Requests | | | ~5,000 | 2,000,000 | 0 | $0.40/1M | $0.00 |

All usage falls within the free monthly grant. **Backend compute: $0.00.**

**If `minReplicas: 1` is required** (to avoid cold starts), the container runs 24/7 at idle rates:

| Meter | Seconds/month | Resource | Total | Free Grant | Billable | Rate | Cost |
|---|---|---|---|---|---|---|---|
| Idle vCPU | 2,628,000 | ×0.5 | 1,314,000 | 180,000 | 1,134,000 | $0.000003/s | $3.40 |
| Idle memory | 2,628,000 | ×1.0 | 2,628,000 | 360,000 | 2,268,000 | $0.000003/s | $6.80 |

**Backend compute with minReplicas: 1: ~$10.20/month** — only $2.21 less than App Service B1.

---

## 5. Recommendation

### Decision Matrix

| Criterion | Container Apps (min 0) | Container Apps (min 1) | App Service B1 |
|---|---|---|---|
| Lowest cost (with free PG) | **$0.50/month** | $10.70/month | $12.91/month |
| Lowest cost (paid PG) | **$16.59/month** | $26.79/month | $29.00/month |
| No cold starts | No (15-30s) | **Yes** | **Yes** |
| Health check works immediately | No | **Yes** | **Yes** |
| App Insights auto-instrumentation | No | No | **Yes** |
| Deployment simplicity | Low (Dockerfile + registry + Job) | Low | **High** (zip deploy) |
| Debugging tools | Limited | Limited | **Full** (Kudu, SSH) |
| Import reliability (0.5 vCPU) | Adequate | Adequate | **Best** (1 core) |
| Migration execution | Container Apps Job | Container Apps Job | **CI step** |
| Additional code required | ~30 lines OTel + Dockerfile | Same | **None** |
| Prisma connection stability | Reconnects on each cold start | Reconnects if idle too long | **Always warm** |
| Future production upgrade path | Direct (already containerized) | Direct | Requires containerization later |

### Final Recommendation: App Service B1

**App Service B1 is the recommended backend compute option.** Rationale:

1. **Operational simplicity outweighs the cost difference.** The $12.41/month difference vs Container Apps (min 0) buys: zero-code App Insights with full APM, Kudu console for debugging, simpler CI/CD, stable Prisma connections, and no cold-start management. For an internal dev environment, operator time is more expensive than $12/month.

2. **Container Apps with `minReplicas: 1` saves only $2.21/month** over App Service B1 while adding Dockerfile maintenance, container registry management, OpenTelemetry SDK integration, and Container Apps Job configuration. The complexity is not justified by $2/month savings.

3. **Container Apps with `minReplicas: 0` saves $12.41/month** but introduces 15-30 second cold starts that break the frontend health check UX. Fixing this requires a frontend code change (loading state with retry). For an internal tool used sporadically, this creates a poor developer experience — every session starts with either a 30-second wait or a fallback to demo mode.

4. **Import reliability.** App Service B1 provides 1 core / 1.75 GB — ample headroom for synchronous imports of up to 10,000 rows. Container Apps at 0.5 vCPU / 1.0 GiB is adequate but slower, with less memory margin for large CSV parsing.

5. **PostgreSQL dominates the cost.** At $16.09/month, PostgreSQL is 55% of the total $29/month bill regardless of compute choice. The free-account benefit (if eligible) saves $16.09/month — more than the entire Container Apps compute savings.

### When to Reconsider Container Apps

Container Apps becomes the better choice when:

- The application is containerized for production deployment (Phase 2+)
- Multiple microservices require independent scaling
- Cost optimization becomes critical at scale (many environments, staging, etc.)
- The team has container operations experience

For now, App Service B1 provides the shortest path to a working cloud dev environment with the fewest moving parts.

### Exact Provisioning Plan

No changes from the current plan. The approved infrastructure remains:

| Resource | Service | SKU | Cost/month |
|---|---|---|---|
| Resource Group | `datakitchen-dev-rg` | — | $0.00 |
| App Service Plan | `datakitchen-dev-plan` | B1 Linux | $12.41 |
| App Service | `datakitchen-api-dev` | Node 20 LTS | (on plan) |
| PostgreSQL | `datakitchen-db-dev` | Burstable B1ms, 32 GB | $16.09 (or $0 if free-eligible) |
| Storage Account | `datakitchenstordev` | Standard LRS | ~$0.50 |
| Application Insights | `datakitchen-insights-dev` | Free tier | $0.00 |
| Log Analytics | `datakitchen-logs-dev` | Free tier | $0.00 |
| Static Web Apps | `icy-stone-00f10fb1e` | Free | $0.00 |
| Entra ID App Regs | `data-kitchen-web-dev` + `data-kitchen-api-dev` | Free | $0.00 |
| **Total** | | | **$29.00** (or **$12.91** with free PG) |

**Action before provisioning:** Verify PostgreSQL free-benefit eligibility (Section 3) to determine whether the total is $29 or $13.

---

## 6. Region Selection: West US 3 (Arizona)

*Approved.* Container Apps Consumption is available in West US 3 (confirmed via Azure Retail Prices API). All services in the approved plan are available. No region change needed.

| Factor | East US 2 (Virginia) | West US 2 (Washington) | West US 3 (Arizona) |
|---|---|---|---|
| RTT from SF Bay Area | ~66 ms | ~24 ms | ~19 ms |
| App Service B1 Linux | $12.41/mo | $12.41/mo | $12.41/mo |
| PostgreSQL B1ms + 32 GB | $16.09/mo | $16.09/mo | $16.09/mo |
| Blob Storage LRS | $0.0184/GB/mo | $0.0184/GB/mo | $0.0184/GB/mo |
| App Insights ingestion | $2.76/GB | $2.30/GB | $2.30/GB |
| Container Apps vCPU (active) | $0.000024/s | $0.000024/s | $0.000024/s |
| PostgreSQL v16 | Yes | Yes | Yes |
| Container Apps Consumption | Yes | Yes | Yes |

---

## 7. Azure Resources

### Resource Summary

| # | Resource | Azure Service | SKU/Tier | Purpose |
|---|---|---|---|---|
| 1 | Resource Group | Resource Group | — | Logical container for all resources |
| 2 | App Service Plan | App Service Plan | B1 (Linux) | Compute for backend API |
| 3 | App Service | App Service | (on B1 plan) | Fastify 5 API server (Node.js 20) |
| 4 | PostgreSQL | Flexible Server | Burstable B1ms | Relational database (10 tables) |
| 5 | Storage Account | Blob Storage | Standard LRS | Uploaded file storage |
| 6 | Application Insights | Monitor | Free tier (5 GB/month) | APM, logging, diagnostics |
| 7 | Static Web Apps | Static Web Apps | Free | Frontend SPA hosting (already exists) |

### Resource Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                  datakitchen-dev-rg (Resource Group)             │
│                  Region: West US 3 (Arizona)                    │
│                                                                 │
│  ┌─────────────────┐     ┌──────────────────────────────────┐  │
│  │  App Insights    │────▶│  App Service (datakitchen-api-dev)│  │
│  │  datakitchen-    │     │  Node.js 20 on B1 Linux plan     │  │
│  │  insights-dev    │     │  Auth: Entra ID (JWT validation) │  │
│  └─────────────────┘     └──────┬─────────────┬─────────────┘  │
│                                 │             │                 │
│                    ┌────────────▼──┐   ┌──────▼──────────────┐  │
│                    │  PostgreSQL    │   │  Storage Account     │  │
│                    │  datakitchen-  │   │  datakitchenstordev  │  │
│                    │  db-dev        │   │  Container: imports  │  │
│                    │  B1ms, SSL req │   │  Standard LRS        │  │
│                    └───────────────┘   └─────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Static Web Apps (icy-stone-00f10fb1e) — ALREADY EXISTS         │
│  React 19 SPA, Free tier                                        │
│  Auth: MSAL (@azure/msal-react) — Entra ID sign-in             │
│  Connects to App Service via VITE_API_BASE_URL (CORS)          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Microsoft Entra ID (Mirchi Labs tenant) — TWO registrations    │
│                                                                 │
│   data-kitchen-web-dev  ──delegated permission──▶ data-kitchen- │
│   (SPA, public client)      access_as_user         api-dev      │
│   redirect URIs, PKCE                          (resource server)│
│                                                 api://<id>      │
│                                                 aud = <id>      │
│  Single-tenant. No client secrets. Cost: $0                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Naming Conventions

| Resource Type | Name | Notes |
|---|---|---|
| Resource Group | `datakitchen-dev-rg` | Contains all dev resources |
| App Service Plan | `datakitchen-dev-plan` | Linux B1, shared by App Service |
| App Service | `datakitchen-api-dev` | `datakitchen-api-dev.azurewebsites.net` |
| PostgreSQL Server | `datakitchen-db-dev` | `datakitchen-db-dev.postgres.database.azure.com` |
| PostgreSQL Database | `datakitchen` | Database name within the server |
| Storage Account | `datakitchenstordev` | Globally unique, lowercase, no hyphens |
| Blob Container | `imports` | Auto-created by application |
| Application Insights | `datakitchen-insights-dev` | Linked to App Service |
| Log Analytics Workspace | `datakitchen-logs-dev` | Required by Application Insights |
| Static Web Apps | `icy-stone-00f10fb1e` | Already exists |
| Entra ID App Registration (SPA) | `data-kitchen-web-dev` | Single-tenant public client |
| Entra ID App Registration (API) | `data-kitchen-api-dev` | Resource server; owns `access_as_user` |

---

## 9. Azure Resource Details

### 9.1 App Service Plan and App Service

| Setting | Value |
|---|---|
| OS / SKU | Linux / B1 (1 core, 1.75 GB RAM) |
| Region | West US 3 |
| Runtime | Node 20 LTS |
| Startup command | `bash /home/site/wwwroot/startup.sh` (applies migrations, then starts the server — Section 11) |
| Container start time limit | 600 seconds (`WEBSITES_CONTAINER_START_TIME_LIMIT`) |
| HTTPS Only | Enabled |
| Always On | Enabled |
| FTPS state | Disabled |
| Health check path | `/api/v1/health` |
| Cost | $12.41/month |

### 9.2 PostgreSQL Flexible Server

| Setting | Value |
|---|---|
| Version | 16 |
| Tier | Burstable B1ms (1 vCore, 2 GB RAM) |
| Storage | 32 GB (Premium SSD); auto-grow disabled |
| Authentication | PostgreSQL (username + password) |
| Database name | `datakitchen` |
| Backup retention | 7 days (LRS) |
| High availability | Disabled |
| Networking mode | Public access with **deny-by-default** firewall (`--public-access None`) |
| TLS | Required (`sslmode=require`) |
| Cost | $16.09/month (or $0 if free-eligible) |

#### PostgreSQL Security

| Control | Detail |
|---|---|
| TLS | `require_secure_transport=ON`; all connections encrypted |
| Admin credentials | Stored in App Service Application Settings only, not in source control |
| Firewall | Deny all by default; explicit per-IP allow rules only (see 9.2.1) |
| Connection string | `postgresql://<admin>:<password>@datakitchen-db-dev.postgres.database.azure.com:5432/datakitchen?sslmode=require` |
| Backup | 32 GB free backup storage; excess at $0.095/GB/month |
| PITR | Any point within 7 days; creates a new server instance |
| Admin password rotation | Manual; rotate quarterly; update `DATABASE_URL` after rotation |

#### 9.2.1 Firewall Configuration (CORRECTED)

> **PROVISIONING NOTE — `--public-access None` does not do what the CLI docs imply.**
>
> On Azure CLI 2.85.0, creating the server with `--public-access None` produced
> `network.publicNetworkAccess = "Disabled"` — not "public networking mode with zero
> firewall rules". With the server in that state, every firewall-rule call is rejected:
>
> ```
> ERROR: Firewall rule operations cannot be requested for a server that doesn't
> have public access enabled.
> ```
>
> The server was **not** VNet-injected (`delegatedSubnetResourceId` and
> `privateDnsZoneArmResourceId` were both null) — it simply had no reachable endpoint.
>
> **Correction applied (non-destructive, no recreate needed):**
>
> ```bash
> az postgres flexible-server update -g $RG -n $DB_SERVER --public-access Enabled
> ```
>
> This flips `publicNetworkAccess` to `Enabled` **without creating any firewall rule**,
> which is the intended deny-by-default state. Verified afterwards: `publicNetworkAccess
> = Enabled`, rule count = 0.
>
> Always run the 9.2.1 verification step after creation. Do not assume `--public-access
> None` left the server in a usable state.

**The previously proposed `--public-access 0.0.0.0` is REMOVED from this plan.**

In `az postgres flexible-server create`, `--public-access 0.0.0.0` creates a firewall rule with start IP `0.0.0.0` and end IP `0.0.0.0`. That is the CLI equivalent of the portal checkbox **"Allow public access from any Azure service within Azure to this server."** It permits connection attempts from any Azure-allocated IP — **including resources in other customers' subscriptions**. It does not restrict access to our App Service. It is not acceptable for this environment.

**Corrected creation flag: `--public-access None`.**

| `--public-access` value | Effect | Use here |
|---|---|---|
| `None` / `Disabled` | Public networking mode enabled, **zero firewall rules**. All connections denied until explicit rules are added. | **Selected** |
| `0.0.0.0` | Creates the "allow all Azure services" rule | Rejected — far broader than it appears |
| `All` | Creates a `0.0.0.0`–`255.255.255.255` rule (entire internet) | Rejected |
| `<IP>` or `<start>-<end>` | Creates one rule for that IP or range | Used post-creation for specific IPs |

**Rule set after provisioning:**

| Rule name | Source | Purpose | Permanent |
|---|---|---|---|
| `allow-appservice-0` … `allow-appservice-N` | App Service `possibleOutboundIpAddresses` | Application and startup-command migrations | Yes |
| `allow-dev-<initials>` | One explicitly approved developer public IP | Manual inspection / emergency access | Optional; remove when not needed |

**Explicitly excluded from the rule set:**

- The "allow all Azure services" rule (`0.0.0.0`) — permits other Azure tenants
- GitHub-hosted runner IP ranges — thousands of addresses, rotate weekly, shared across all GitHub customers
- Any `0.0.0.0/0`-equivalent range

**Why `possibleOutboundIpAddresses` and not `outboundIpAddresses`:** `outboundIpAddresses` returns only the addresses currently in use. `possibleOutboundIpAddresses` returns the full superset the platform may use within the same tier family. Using the current-only list risks intermittent connection failures when Azure shifts the app between workers.

**Provisioning commands:**

```bash
# 1. Create the server with NO firewall rules
az postgres flexible-server create \
  --resource-group $RG --name $DB_SERVER --location $LOCATION \
  --admin-user $DB_ADMIN --admin-password "$DB_PASSWORD" \
  --sku-name Standard_B1ms --tier Burstable \
  --storage-size 32 --version 16 \
  --public-access None --yes

# 2. After the App Service exists, allow its outbound IPs
OUTBOUND_IPS=$(az webapp show \
  --resource-group $RG --name $APP \
  --query possibleOutboundIpAddresses --output tsv)

IFS=',' read -ra IPS <<< "$OUTBOUND_IPS"
for i in "${!IPS[@]}"; do
  az postgres flexible-server firewall-rule create \
    --resource-group $RG --name $DB_SERVER \
    --rule-name "allow-appservice-${i}" \
    --start-ip-address "${IPS[$i]}" --end-ip-address "${IPS[$i]}"
done

# 3. Optional: allow one approved developer IP
az postgres flexible-server firewall-rule create \
  --resource-group $RG --name $DB_SERVER \
  --rule-name "allow-dev-sg" \
  --start-ip-address "<approved-developer-public-ip>" \
  --end-ip-address "<approved-developer-public-ip>"
```

#### 9.2.2 Updating Firewall Rules When Outbound IPs Change

App Service outbound IPs change when:

- The App Service Plan is scaled **between tier families** (Basic → Standard → PremiumV3)
- The App Service Plan is deleted and recreated
- Azure performs platform maintenance (rare)

They do **not** change on restart, redeploy, or instance-count changes within the same tier.

**Symptom of a stale rule set:** the app starts but every request fails with a Prisma connection error (`P1001: Can't reach database server`), or the startup-command migration fails with a connection timeout.

**Update procedure:**

```bash
# 1. Re-read the current possible outbound IPs
NEW_IPS=$(az webapp show \
  --resource-group $RG --name $APP \
  --query possibleOutboundIpAddresses --output tsv)

# 2. List existing rules to see which are stale
az postgres flexible-server firewall-rule list \
  --resource-group $RG --name $DB_SERVER --output table

# 3. Delete the old allow-appservice-* rules (keep allow-dev-*)
for RULE in $(az postgres flexible-server firewall-rule list \
    --resource-group $RG --name $DB_SERVER \
    --query "[?starts_with(name,'allow-appservice-')].name" -o tsv); do
  az postgres flexible-server firewall-rule delete \
    --resource-group $RG --name $DB_SERVER --rule-name "$RULE" --yes
done

# 4. Recreate with the new IPs
IFS=',' read -ra IPS <<< "$NEW_IPS"
for i in "${!IPS[@]}"; do
  az postgres flexible-server firewall-rule create \
    --resource-group $RG --name $DB_SERVER \
    --rule-name "allow-appservice-${i}" \
    --start-ip-address "${IPS[$i]}" --end-ip-address "${IPS[$i]}"
done

# 5. Restart the app so the startup command re-runs against a reachable DB
az webapp restart --resource-group $RG --name $APP
```

**Operational note:** run step 1–4 as a checklist item any time the App Service Plan tier is changed. Record the change in the deployment log.

#### 9.2.3 Considered and Deferred: VNet Private Access

App Service Basic (B1) does support VNet integration (GA since April 2022), and PostgreSQL Flexible Server supports private (VNet-injected) access. That combination removes the public endpoint entirely.

**Deferred for this environment** because:

- PostgreSQL networking mode is **permanent at creation** — a public-access server cannot later be converted to private access, and vice versa. Choosing VNet now locks in the harder path.
- With private access there is no public endpoint, so a developer cannot connect from a laptop without a VPN gateway, Azure Bastion + jump box, or `az postgres flexible-server connect` through an integrated resource. Each adds cost and setup for an internal dev environment.
- The deny-by-default firewall with explicit per-IP rules already excludes all of the broad-access patterns this correction targets.

**Revisit when:** provisioning the production environment, where private access should be the default and developer access is expected to go through a bastion.

### 9.3 Storage Account

| Setting | Value |
|---|---|
| SKU | Standard LRS |
| Blob public access | Disabled |
| Container | `imports` (auto-created) |
| Cost | ~$0.50/month |

### 9.4 Application Insights

| Setting | Value |
|---|---|
| Workspace | `datakitchen-logs-dev` (Log Analytics) |
| Sampling | Enabled (default adaptive) |
| Daily cap | 0.5 GB |
| Data retention | 31 days (free) |
| Integration | Auto-instrumentation via App Service portal blade (zero code) |
| Cost | $0/month (within 5 GB/month free tier) |

**Sensitive data protection:** Auto-instrumentation does NOT log request/response bodies, `Authorization` headers, database credentials, or storage credentials. Tokens, uploaded file contents, and product payloads are excluded by default.

### 9.5 Entra ID App Registrations (CORRECTED — two registrations)

#### 9.5.1 Decision

**Two app registrations are selected**, replacing the previously proposed single `data-kitchen-dev` registration:

| Registration | Represents | Holds |
|---|---|---|
| `data-kitchen-web-dev` | The React SPA (public client) | SPA platform config, redirect URIs, delegated permission to the API scope |
| `data-kitchen-api-dev` | The Fastify API (resource server) | Application ID URI, the `access_as_user` scope definition, token version |

#### 9.5.2 Comparison

| Dimension | Single registration | Two registrations |
|---|---|---|
| **MSAL token acquisition** | Scope is `api://<same-client-id>/access_as_user`. Works, but the client is requesting a scope on itself. The audience of the resulting token equals the SPA's own client ID, which is the pattern most likely to be misconfigured into returning an ID token instead of an access token if the scope is ever shortened to `openid`/`profile` or the bare client ID. | Scope is `api://<api-client-id>/access_as_user` — a different resource from the caller. This is the standard OAuth2 client→resource-server flow and is unambiguous. |
| **API audience validation** | `aud` equals the single client ID. The API cannot distinguish "a token minted for the API" from "a token minted for the SPA as a client" — they are the same value. | `aud` equals the API's client ID. Validation is a single exact comparison against a value that only the API owns. |
| **Future additional API clients** | A CLI tool or mobile app must be added as a second registration anyway, and then be granted permission to a scope that lives on the SPA's registration — an inverted ownership model that gets confusing quickly. | Each new client gets its own registration and is granted the existing `access_as_user` scope on the API registration. No change to the API registration's identity. |
| **Future customer authentication** | Converting to multi-tenant means changing `signInAudience` on a registration that is simultaneously the client and the resource. Consent behaviour for the two roles differs and has to be reasoned about together. | The API registration's `signInAudience` and the SPA registration's can be changed independently. Customer-facing clients can be added without touching the API's identity or scope definition. |
| **Least privilege** | The SPA registration owns the API surface. Anyone with write access to the SPA registration can alter the API's exposed scopes. | The API's scope definition is separately ownable and separately auditable. The SPA holds only a delegated permission. |
| **Internal-dev complexity** | One registration to create. | Two registrations. Roughly 10 extra minutes of portal work, one extra client ID to record. |

#### 9.5.3 Recommendation

**Use two registrations.** The added setup cost is one extra portal object and one extra environment variable. In exchange, audience validation becomes an exact match against a value the API exclusively owns, and both listed future paths — additional API clients and customer authentication — become additive rather than a restructuring of an existing registration. Reworking a single registration into two after users exist requires re-consent and a coordinated frontend/backend cutover; doing it before any user exists costs nothing.

#### 9.5.4 `data-kitchen-api-dev` (resource server)

| Setting | Value |
|---|---|
| Name | `data-kitchen-api-dev` |
| Account types | Single tenant (Mirchi Labs only) |
| Platform | None (no redirect URIs — it never signs a user in) |
| Application ID URI | `api://<api-client-id>` |
| Exposed scope | `access_as_user` |
| Scope consent | Admins and users |
| Scope admin consent display name | "Access Data Kitchen as the signed-in user" |
| `accessTokenAcceptedVersion` (manifest) | `2` |
| Client secret | **None** — the API validates tokens against the public JWKS endpoint; it never calls Entra ID as a client |
| Cost | $0 |

With `accessTokenAcceptedVersion: 2`, the issued token carries `aud` = the **API's client ID (bare GUID)**, and `iss` = `https://login.microsoftonline.com/<tenant-id>/v2.0`. The `api://` prefix appears in the *scope string the client requests*, not in the `aud` claim.

#### 9.5.5 `data-kitchen-web-dev` (SPA client)

| Setting | Value |
|---|---|
| Name | `data-kitchen-web-dev` |
| Account types | Single tenant (Mirchi Labs only) |
| Platform | Single-page application |
| Redirect URIs | `http://localhost:5173`, `https://<swa-hostname>` |
| API permission | `data-kitchen-api-dev` → delegated → `access_as_user` |
| Admin consent | Granted once at setup |
| Client secret | **None** — public client, authorization code flow with PKCE |
| Cost | $0 |

#### 9.5.6 Resulting Configuration

**Frontend MSAL scope request:**

```
scopes: ["api://<api-client-id>/access_as_user"]
```

**Backend validation** (`EntraAuthProvider`):

| Claim | Expected value | Source env var |
|---|---|---|
| `iss` | `https://login.microsoftonline.com/<tenant-id>/v2.0` | `ENTRA_TENANT_ID` |
| `aud` | `<api-client-id>` | `ENTRA_API_CLIENT_ID` |
| `tid` | `<tenant-id>` | `ENTRA_TENANT_ID` |
| `exp` / `nbf` | Validated by `jose` | — |
| Signature | Verified against `https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys` | `ENTRA_TENANT_ID` |

The backend needs the **API** client ID only. It does not need, and must not be configured with, the SPA client ID.

---

## 10. Environment Variables

### Backend — App Service Application Settings

| Variable | Value | Required |
|---|---|---|
| `NODE_ENV` | `production` | Yes |
| `AUTH_MODE` | `entra` | Yes |
| `ENTRA_TENANT_ID` | `<mirchi-labs-tenant-id>` | Yes |
| `ENTRA_API_CLIENT_ID` | `<data-kitchen-api-dev client ID>` | Yes |
| `DATABASE_URL` | `postgresql://...sslmode=require&connection_limit=5` | Yes |
| `STORAGE_PROVIDER` | `azure` | Yes |
| `AZURE_STORAGE_CONNECTION_STRING` | (from Storage Account) | Yes |
| `ALLOWED_ORIGINS` | `https://<swa-hostname>` | Yes |
| `WEBSITES_CONTAINER_START_TIME_LIMIT` | `600` | Yes (allows migration time at startup) |
| `PORT` | `8080` | No (Azure sets automatically) |
| `HOST` | `0.0.0.0` | No |

`DEV_AUTH_TOKEN` and `VITE_DEV_AUTH_TOKEN` are **NOT** set in the cloud environment.

`ENTRA_API_CLIENT_ID` replaces the previously proposed `ENTRA_CLIENT_ID`. The backend validates `aud` against the **API** registration's client ID and has no use for the SPA's client ID.

### Frontend — Build-Time Variables

| Variable | Value | Where Set |
|---|---|---|
| `VITE_API_BASE_URL` | `https://datakitchen-api-dev.azurewebsites.net` | GitHub Variable |
| `VITE_ENTRA_CLIENT_ID` | `<data-kitchen-web-dev client ID>` | GitHub Variable |
| `VITE_ENTRA_TENANT_ID` | `<mirchi-labs-tenant-id>` | GitHub Variable |
| `VITE_ENTRA_API_SCOPE` | `api://<data-kitchen-api-dev client ID>/access_as_user` | GitHub Variable |

Note the two distinct client IDs: `VITE_ENTRA_CLIENT_ID` is the **SPA** registration; the GUID inside `VITE_ENTRA_API_SCOPE` is the **API** registration.

### GitHub Secrets

| Secret | Purpose |
|---|---|
| `AZURE_CREDENTIALS` | Backend deployment auth |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_ICY_STONE_00F10FB1E` | Frontend deployment auth |

**`DATABASE_URL` is deliberately not a GitHub secret.** CI never connects to the database — migrations run on the App Service (Section 11).

---

## 11. Prisma Migration Execution (CORRECTED)

### 11.1 The Conflict

The previous plan ran `npx prisma migrate deploy` as a **GitHub Actions step**. That is incompatible with the corrected firewall policy in Section 9.2.1:

- The migration runs on a GitHub-hosted runner with an ephemeral public IP.
- PostgreSQL denies all traffic except the App Service outbound IPs and one approved developer IP.
- Making it work would require permanently allowing GitHub's runner ranges — thousands of addresses, rotated weekly, shared with every GitHub customer. That is exactly the broad access this correction removes.

**Resolution: migrations move to the Azure side.** The migration must execute from a host that already holds a firewall allowance — the App Service itself.

### 11.2 Options Evaluated

| Option | Runs from App Service (DB reachable)? | Runs before new code serves traffic? | Available on B1 Linux? | Verdict |
|---|---|---|---|---|
| **A. App Service startup command** | Yes — executes inside the app container | Yes — traffic is not routed until the container responds to the warmup probe, and the shell `&&` prevents the server from starting if the migration fails | Yes | **SELECTED** |
| B. Oryx build hooks (`POST_BUILD_COMMAND`) | No — runs in the Kudu/SCM build container | No — build phase, not runtime | Yes, but | Rejected |
| C. Deployment slot (deploy → migrate → swap) | Yes | Yes | **No — slots require Standard S1+** | Not available |
| D. Kudu/SCM REST API (`/api/command`) | Partially — on Linux this runs in the **Kudu container**, not the app container | Only with manual CI orchestration (stop app → deploy → migrate → start) | Yes | Rejected as primary; documented as break-glass |
| E. `az webapp ssh` / remote connection | Yes | No — requires the app to already be running | Interactive only | Rejected |

**Why B is rejected:** Oryx build hooks run during the build phase in the Kudu container. Two problems compound: (1) when the CI pipeline builds the artifact and zip-deploys it, Oryx does not run on App Service at all unless `SCM_DO_BUILD_DURING_DEPLOYMENT=true`, so the hook silently never fires; (2) even when it does fire, the Kudu container is a different container from the runtime container and is not a reliable place to assume database reachability or the correct runtime dependencies.

**Why C is unavailable:** deployment slots require Standard (S1) or higher. Basic (B1) supports zero slots. Revisit if the plan is ever upgraded to S1 — deploy-to-staging, migrate-in-staging, verify, then swap is the strongest pattern available on App Service.

**Why D is rejected as the primary mechanism:** on Linux App Service, `POST /api/command` executes in the Kudu/SCM container rather than the app container, so database reachability is not guaranteed. It also has a ~100–120 second timeout and requires the CI workflow to orchestrate a stop/deploy/migrate/start sequence, which introduces downtime and more failure modes than the startup command. It remains useful as a **manual break-glass path** (see 11.5).

### 11.3 Selected Mechanism: Startup Command

A `startup.sh` script runs the migration and then starts the server, chained with `&&`.

**`server/startup.sh`** (new file, committed to the repository, deployed with the artifact):

```bash
#!/bin/bash
set -e

echo "[startup] Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "[startup] Migrations applied. Starting server..."
exec node dist/index.js
```

Prisma is invoked through its resolved module path rather than `npx` because Kudu's zip-deploy packaging can strip dot-prefixed directories (including `.prisma`), and `npx` may attempt a network fetch if the local binary is not found.

**App Service configuration:**

```bash
az webapp config set \
  --resource-group $RG --name $APP \
  --startup-file "bash /home/site/wwwroot/startup.sh"

# Allow up to 10 minutes for migration + server start before the platform
# declares the container failed. Default is 230s; max is 1800s.
az webapp config appsettings set \
  --resource-group $RG --name $APP \
  --settings WEBSITES_CONTAINER_START_TIME_LIMIT=600
```

### 11.4 Why This Satisfies "Migrate Before Serving"

App Service routes traffic to a container only after the container responds to the platform warmup probe (`GET /robots933456.txt`) on the expected port. The ordering guarantee is therefore structural:

1. Container starts, `startup.sh` begins.
2. `prisma migrate deploy` runs. **No port is open. No traffic is routed.**
3. On success, `exec node dist/index.js` starts Fastify, which binds the port.
4. The warmup probe succeeds; the configured health check path `/api/v1/health` must also return 200.
5. Traffic is routed.

On migration failure, `set -e` and the missing `&&` continuation mean `node dist/index.js` never executes. The container exits non-zero, never opens a port, and App Service never routes traffic to it. **The previously deployed, working version continues serving.**

### 11.5 Failure Handling — No Destructive Rollback

**If a migration fails, the following happens and nothing else:**

1. The new container exits non-zero and does not serve traffic.
2. App Service retries the container start with backoff. There is no maximum retry count — the container will loop until the problem is fixed or the app is stopped.
3. The database is left in whatever state `prisma migrate deploy` reached. Prisma applies migrations one at a time inside transactions where the SQL permits; a failed migration is recorded in `_prisma_migrations` with a `logs` column containing the error.
4. **No automatic reversal is attempted.** No `migrate reset`, no down-migration, no data deletion.

**Human response procedure:**

```bash
# 1. Read the failure
az webapp log tail --resource-group $RG --name $APP

# 2. Stop the crash loop while investigating
az webapp stop --resource-group $RG --name $APP

# 3. Inspect migration state from an approved developer IP
#    (requires the allow-dev-* firewall rule to be present)
npx prisma migrate status
```

4. Fix the migration in a new commit — as a **forward** migration. Do not edit an applied migration in place.
5. Redeploy. `az webapp start`.

Manual SQL reversal is permitted only when a human has inspected the state and decided it is necessary. It is never automated.

### 11.6 Retained Safety Rules

1. **Migrations are additive only.** New columns carry defaults. A column is dropped only in a later release, after the deployed code no longer references it.
2. **`prisma migrate deploy` is idempotent.** With no pending migrations it exits immediately, so running it on every container start is safe and cheap.
3. **Concurrency is safe.** Prisma serializes migration application via an advisory lock. B1 runs a single instance, so concurrent execution does not arise today; the lock covers a future scale-out.
4. **`DATABASE_URL` is never a CI secret.** It is an App Service Application Setting only. GitHub Actions never holds database credentials.

### 11.7 Break-Glass: Manual Migration via Kudu

For the rare case where the startup command cannot be used (for example, a migration must be applied without deploying new code), a human may run it from the Kudu SSH console:

1. Azure portal → App Service → **Development Tools** → **SSH**
2. `cd /home/site/wwwroot`
3. `node node_modules/prisma/build/index.js migrate deploy`

This runs in the app container, so the App Service firewall allowance applies. It is a deliberate, human-initiated action and is not part of any automated pipeline.

---

## 12. Deployment Order (CORRECTED)

The previous order provisioned and deployed before the Entra authentication code existed. That would have exposed a publicly reachable App Service endpoint running `AUTH_MODE=development` — a shared bearer token on an internet-facing API. **Authentication code is now implemented and tested before any Azure resource is created**, and the endpoint is not treated as usable until the rejection tests in Section 12.1 pass against the deployed instance.

### Phase 0 — Verify Benefits (no resources created)

| Step | Action |
|---|---|
| 0.1 | Verify PostgreSQL free-benefit eligibility and any VS / Startups / Partner credits (Section 3). Determines whether the monthly total is ~$29 or ~$13. |

### Phase 1 — Entra ID Registrations (no compute, no data)

| Step | Action |
|---|---|
| 1.1 | Create `data-kitchen-api-dev`. Set Application ID URI `api://<api-client-id>`. Expose scope `access_as_user`. Set manifest `accessTokenAcceptedVersion: 2`. Record the client ID. |
| 1.2 | Create `data-kitchen-web-dev`. Add SPA platform with redirect URIs `http://localhost:5173` and the SWA hostname. Add delegated permission to `data-kitchen-api-dev` → `access_as_user`. Grant admin consent. Record the client ID. |
| 1.3 | Record the Mirchi Labs tenant ID. |

### Phase 2 — Implement and Test Authentication Locally (no Azure compute)

| Step | Action |
|---|---|
| 2.1 | Add `jose` to `server/package.json`. Implement `server/src/auth/entra-auth-provider.ts`. |
| 2.2 | Add `AUTH_MODE=entra` branch and `ENTRA_TENANT_ID` / `ENTRA_API_CLIENT_ID` to `server/src/config.ts`; fail fast at startup if either is missing when `AUTH_MODE=entra`. |
| 2.3 | Write `server/test/unit/entra-auth-provider.test.ts` covering every rejection case in Section 12.1 using locally minted JWTs and a stub JWKS. |
| 2.4 | Add MSAL to the frontend: `src/auth/authConfig.ts`, `MsalProvider` in `src/main.tsx`, token acquisition in `src/lib/api-client.ts`, login/logout UI. Remove `VITE_DEV_AUTH_TOKEN` from the client. |
| 2.5 | **Gate:** full backend suite passes, `npx tsc --noEmit` clean on both packages, and a local run against the real Entra ID tenant completes an interactive sign-in and an authenticated API call. Do not proceed until this passes. |

### Phase 3 — Create Azure Resources

| Step | Action |
|---|---|
| 3.1 | Create resource group `datakitchen-dev-rg` in `westus3`. |
| 3.2 | Create PostgreSQL Flexible Server with `--public-access None` (zero firewall rules — nothing can connect yet). Create the `datakitchen` database. |
| 3.3 | Create the Storage Account with `--allow-blob-public-access false`. |
| 3.4 | Create the Log Analytics workspace, then Application Insights linked to it. Set the 0.5 GB daily cap. |
| 3.5 | Create the App Service Plan (B1 Linux) and the App Service (Node 20 LTS). |

### Phase 4 — Configure PostgreSQL Firewall

| Step | Action |
|---|---|
| 4.1 | Read `possibleOutboundIpAddresses` from the App Service. |
| 4.2 | Create one `allow-appservice-N` rule per outbound IP (Section 9.2.1). |
| 4.3 | Optionally create one `allow-dev-<initials>` rule for an approved developer public IP. |
| 4.4 | **Verify** the rule list contains no `0.0.0.0` rule and no wide range: `az postgres flexible-server firewall-rule list -g $RG -n $DB_SERVER -o table`. |

### Phase 5 — Configure App Service and Storage

| Step | Action |
|---|---|
| 5.1 | Set all Application Settings (Section 10), including `AUTH_MODE=entra`, `ENTRA_API_CLIENT_ID`, `DATABASE_URL`, and `WEBSITES_CONTAINER_START_TIME_LIMIT=600`. |
| 5.2 | Set the startup command to `bash /home/site/wwwroot/startup.sh`. |
| 5.3 | Enable HTTPS Only, Always On; disable FTPS. Set health check path `/api/v1/health`. |
| 5.4 | Enable Application Insights auto-instrumentation on the App Service. |

### Phase 6 — Configure GitHub

| Step | Action |
|---|---|
| 6.1 | Set GitHub Secrets: `AZURE_CREDENTIALS`, SWA deployment token. **Do not add `DATABASE_URL`.** |
| 6.2 | Set GitHub Variables: `VITE_API_BASE_URL`, `VITE_ENTRA_CLIENT_ID` (SPA), `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_API_SCOPE` (API). |
| 6.3 | Remove any `VITE_DEV_AUTH_TOKEN` reference from the frontend workflow. Remove the `prisma migrate deploy` step from the backend workflow. |

### Phase 7 — Deploy Backend and Apply Migrations

| Step | Action |
|---|---|
| 7.1 | Deploy the backend via GitHub Actions. |
| 7.2 | The startup command applies migrations inside the app container before Fastify binds the port (Section 11). |
| 7.3 | Confirm in `az webapp log tail` that migrations applied and the server started. If migrations failed, the container will not serve traffic — follow Section 11.5. |
| 7.4 | Seed the initial organization, user (with `externalIdentityId` set to the Entra `oid` of the first Mirchi Labs user), and membership. |

### Phase 8 — Authentication Verification Gate

| Step | Action |
|---|---|
| 8.1 | `GET /api/v1/health` returns 200. |
| 8.2 | **Run every check in Section 12.1 against the deployed endpoint.** |
| 8.3 | **The App Service endpoint is not considered usable until 12.1 passes in full.** Do not deploy the frontend or share the URL before this gate clears. |

### Phase 9 — Deploy Frontend

| Step | Action |
|---|---|
| 9.1 | Deploy the SPA via GitHub Actions. |
| 9.2 | Confirm the built bundle contains no `VITE_DEV_AUTH_TOKEN` value: download `assets/*.js` from the SWA hostname and grep for the token string and for `DEV_AUTH`. |
| 9.3 | Interactive sign-in with a Mirchi Labs account succeeds; the health check reports live mode. |

### Phase 10 — End-to-End and Isolation Verification

| Step | Action |
|---|---|
| 10.1 | Run the full multi-tenant import test: sign in, create a catalog, upload a CSV, complete the synchronous import, view canonical products. |
| 10.2 | Confirm the uploaded blob is written under the `<organizationId>/` prefix in the `imports` container, and that no blob exists outside an org prefix. |
| 10.3 | Confirm provenance rows link each canonical product to its source row and import run. |
| 10.4 | Confirm product history rows were written for the import. |
| 10.5 | Confirm `audit_log` rows exist for the import, carry the correct `organizationId` and `userId`, and contain no token, credential, or raw row payload. |
| 10.6 | Tenant isolation: with a second organization seeded, confirm a user in org A cannot read org B's catalogs, products, imports, or blobs; and that `X-Organization-Id` naming an org the user has no active membership in returns 403 `INVALID_ORGANIZATION`. |
| 10.7 | Confirm Application Insights shows requests and dependencies, and that no `Authorization` header value, connection string, or uploaded row content appears in telemetry. |

### 12.1 Authentication Verification Checklist

Every row must pass **both** as a unit test (Phase 2.3, against locally minted tokens) and against the deployed endpoint (Phase 8.2). Deployed-endpoint checks use `curl` against `https://datakitchen-api-dev.azurewebsites.net/api/v1/catalogs` — an authenticated route, not `/health`.

| # | Case | How to produce it | Expected |
|---|---|---|---|
| 1 | **Missing bearer token** | `curl` with no `Authorization` header | `401` |
| 2 | **Malformed / invalid token** | `Authorization: Bearer not-a-jwt`, and a well-formed JWT signed with a key not in the tenant JWKS | `401` |
| 3 | **Wrong tenant** | A valid Entra token issued by a different tenant (`iss`/`tid` mismatch) | `401` |
| 4 | **Wrong audience** | A valid Mirchi-tenant token whose `aud` is some other resource (e.g. Microsoft Graph) rather than `ENTRA_API_CLIENT_ID` | `401` |
| 5 | **Expired token** | A token whose `exp` is in the past | `401` |
| 6 | **Valid Mirchi token resolves the correct user** | Sign in as a seeded Mirchi Labs user; call an authenticated route | `200`; response is scoped to that user's organization; `audit_log` records the correct `userId` |
| 7 | **Inactive user rejected** | Set the seeded user's `status` to `inactive`; retry with the same valid token | `403` `FORBIDDEN` — "User account not found or inactive" |
| 8 | **Unknown user rejected** | Valid Mirchi tenant token for a user with no `User` row matching the `oid` | `403` `FORBIDDEN` |
| 9 | **Inactive membership rejected** | Set the user's `OrganizationMembership.status` to `inactive` (or the organization's `status` to `inactive`); retry | `403` `FORBIDDEN` — "No active organization membership" |
| 10 | **Organization selection is membership-validated** | Send `X-Organization-Id` naming an organization the user has no active membership in | `403` `INVALID_ORGANIZATION` |
| 11 | **Ambiguous org requires explicit selection** | User with two active memberships, no `X-Organization-Id` | `400` `ORGANIZATION_REQUIRED`, listing only that user's organizations |
| 12 | **Valid org selection honoured** | Same user, `X-Organization-Id` naming one of their active memberships | `200`; all data scoped to the selected organization |

**Note on status codes:** cases 1–5 are authentication failures and return `401`. Cases 7–10 are authorization failures — the token is genuine, but the principal is not permitted — and return `403` from `AutoTenantResolver`. Case 11 returns `400` because the request is well-formed but under-specified. This distinction is intentional and already implemented in [auto-tenant-resolver.ts](server/src/auth/auto-tenant-resolver.ts).

**Do not log tokens while testing.** Compare status codes and error codes only. Do not paste real access tokens into the repository, issue trackers, or CI logs.

---

## 13. Security Summary

| Component | Mechanism |
|---|---|
| User authentication | Microsoft Entra ID (MSAL + JWT) — Mirchi Labs tenant only; verified by the Section 12.1 checklist before the endpoint is used |
| API authorization | JWT signature/issuer/audience/tenant validation, then membership-validated tenant resolution and tenant-scoped queries |
| Entra registrations | Two: SPA public client (PKCE, no secret) + API resource server (no secret) |
| Database network | Deny-by-default firewall; explicit per-IP allow rules for App Service outbound IPs and one optional approved developer IP. No "allow all Azure services" rule. No CI runner ranges. |
| Database transport | TLS required (`sslmode=require`) |
| Database credentials | App Service Application Settings only. Never in source control, never a GitHub secret. |
| Migrations | Executed from inside the App Service container at startup; CI holds no database access |
| Blob Storage | Connection-string auth; public access disabled; org-prefixed paths |
| CORS | Fastify middleware; SWA origin only |
| App Service | HTTPS Only; FTPS disabled; Always On |
| Audit logging | `audit_log` table; no tokens, credentials, or raw row payloads recorded |
| Request correlation | `X-Request-Id` header |

---

## 14. Code Changes Required (Before Cloud Deployment)

### Backend

| Change | Files |
|---|---|
| Add `EntraAuthProvider` | New: `server/src/auth/entra-auth-provider.ts` (~30 lines) |
| Add `jose` dependency | `server/package.json` |
| Add `AUTH_MODE=entra` handling with fail-fast config validation | `server/src/index.ts`, `server/src/config.ts` |
| Add `EntraAuthProvider` tests covering all Section 12.1 rejection cases | `server/test/unit/entra-auth-provider.test.ts` |
| Add migration startup script | New: `server/startup.sh` |

### Frontend

| Change | Files |
|---|---|
| Add MSAL dependencies | `package.json` |
| Add auth configuration | New: `src/auth/authConfig.ts` (~20 lines) |
| Wrap app with MsalProvider | `src/main.tsx` |
| Replace token injection | `src/lib/api-client.ts` |
| Add login/logout UI | `src/components/` |

---

## 15. Approval Package

| # | Item | Decision / Value |
|---|---|---|
| 1 | **Authentication** | MSAL + JWT. Entra ID single-tenant. No `VITE_DEV_AUTH_TOKEN` in cloud. |
| 2 | **Backend compute** | App Service B1 Linux ($12.41/month). *Approved.* |
| 3 | **SWA plan** | Free. MSAL handles auth in SPA code. |
| 4 | **Region** | West US 3 (Arizona). Lowest latency; same pricing. |
| 5 | **PostgreSQL** | Burstable B1ms, 32 GB ($16.09/month or $0 with free benefit). |
| 6 | **Storage** | Standard LRS (~$0.50/month). |
| 7 | **Application Insights** | Free tier. Auto-instrumentation. No sensitive data logged. |
| 8 | **Container registry** | Not needed (App Service uses zip deploy). |
| 9 | **Total cost** | ~$29/month (paid PG) or ~$13/month (free PG). |
| 10 | **PostgreSQL free benefit** | Verify eligibility before provisioning (Section 3). |
| 11 | **PostgreSQL firewall** *(corrected)* | `--public-access None` at creation — zero rules. Then explicit per-IP rules for App Service `possibleOutboundIpAddresses` plus one optional approved developer IP. **`--public-access 0.0.0.0` removed** — it allows all Azure services from all subscriptions. No GitHub runner ranges. Update procedure documented in 9.2.2. VNet private access considered and deferred to production (9.2.3). |
| 12 | **Migration execution** *(corrected)* | App Service **startup command** (`startup.sh`) runs `prisma migrate deploy` inside the app container before Fastify binds the port. GitHub Actions no longer runs migrations and holds no `DATABASE_URL`. Oryx hooks, deployment slots (unavailable on B1), Kudu API, and `az webapp ssh` evaluated and rejected (11.2). |
| 13 | **Migration failure handling** | Container exits non-zero, never opens a port, previous version keeps serving. No automatic rollback, no `migrate reset`, no data deletion. Human-driven forward fix only (11.5). |
| 14 | **Entra registrations** *(corrected)* | **Two:** `data-kitchen-web-dev` (SPA public client) and `data-kitchen-api-dev` (resource server owning `access_as_user`). Backend validates `aud` against `ENTRA_API_CLIENT_ID`. Replaces the single-registration design (9.5). |
| 15 | **Auth-before-activation** *(corrected)* | Entra code implemented and tested in Phase 2, before any Azure resource exists. The deployed endpoint is not usable until the 12-case checklist in Section 12.1 passes against it (Phase 8). |
| 16 | **Deployment order** *(corrected)* | 10 phases: benefits → registrations → auth code + tests → resources → firewall → app config → GitHub config → deploy + migrate → **auth gate** → frontend → end-to-end and isolation verification (Section 12). |
| 17 | **Code changes** | Backend: `EntraAuthProvider` + `jose` + `startup.sh`. Frontend: MSAL + remove dev token. |
| 18 | **CI/CD changes** | Backend: **remove** the migrate step; add health check. Frontend: remove dev token, add Entra vars. No `DATABASE_URL` secret. |
| 19 | **What is NOT changed** | Tenant model, canonical-product model, provenance, history, audit models, architecture, schema. |

---

## Appendix: az CLI Provisioning Commands (CORRECTED)

> Run only after the Section 12 Phase 0–2 gates have cleared. The ordering below matters: the PostgreSQL firewall cannot be configured until the App Service exists.

```bash
RG="datakitchen-dev-rg"
LOCATION="westus3"
PLAN="datakitchen-dev-plan"
APP="datakitchen-api-dev"
DB_SERVER="datakitchen-db-dev"
DB_NAME="datakitchen"
DB_ADMIN="dkadmin"
STORAGE="datakitchenstordev"
INSIGHTS="datakitchen-insights-dev"
LOGS_WORKSPACE="datakitchen-logs-dev"

# --- Phase 3: create resources -------------------------------------------

az group create --name $RG --location $LOCATION

# Deny-by-default: creates the server with ZERO firewall rules.
# NOT --public-access 0.0.0.0 (that allows all Azure services, all subscriptions).
az postgres flexible-server create \
  --resource-group $RG --name $DB_SERVER --location $LOCATION \
  --admin-user $DB_ADMIN --admin-password "$DB_PASSWORD" \
  --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 16 \
  --public-access None --yes

az postgres flexible-server db create \
  --resource-group $RG --server-name $DB_SERVER --database-name $DB_NAME

az storage account create \
  --resource-group $RG --name $STORAGE --location $LOCATION \
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access false

az monitor log-analytics workspace create \
  --resource-group $RG --workspace-name $LOGS_WORKSPACE --location $LOCATION

az monitor app-insights component create \
  --resource-group $RG --app $INSIGHTS --location $LOCATION \
  --kind web --application-type web --workspace $LOGS_WORKSPACE

az appservice plan create \
  --resource-group $RG --name $PLAN --location $LOCATION --sku B1 --is-linux

az webapp create \
  --resource-group $RG --plan $PLAN --name $APP --runtime "NODE:20-lts"

# --- Phase 4: PostgreSQL firewall (App Service must exist first) ----------

OUTBOUND_IPS=$(az webapp show \
  --resource-group $RG --name $APP \
  --query possibleOutboundIpAddresses --output tsv)

IFS=',' read -ra IPS <<< "$OUTBOUND_IPS"
for i in "${!IPS[@]}"; do
  az postgres flexible-server firewall-rule create \
    --resource-group $RG --name $DB_SERVER \
    --rule-name "allow-appservice-${i}" \
    --start-ip-address "${IPS[$i]}" --end-ip-address "${IPS[$i]}"
done

# Optional: one explicitly approved developer public IP
# az postgres flexible-server firewall-rule create \
#   --resource-group $RG --name $DB_SERVER --rule-name "allow-dev-sg" \
#   --start-ip-address "<approved-ip>" --end-ip-address "<approved-ip>"

# Verify: expect only allow-appservice-* and optionally allow-dev-*.
# Any rule with start IP 0.0.0.0 must be deleted.
az postgres flexible-server firewall-rule list \
  --resource-group $RG --name $DB_SERVER --output table

# --- Phase 5: App Service configuration ----------------------------------

az webapp config set \
  --resource-group $RG --name $APP \
  --startup-file "bash /home/site/wwwroot/startup.sh" \
  --always-on true --ftps-state Disabled

az webapp config set \
  --resource-group $RG --name $APP \
  --generic-configurations '{"healthCheckPath": "/api/v1/health"}'

az webapp update --resource-group $RG --name $APP --https-only true

az webapp config appsettings set \
  --resource-group $RG --name $APP --settings \
  NODE_ENV=production \
  AUTH_MODE=entra \
  ENTRA_TENANT_ID="<mirchi-labs-tenant-id>" \
  ENTRA_API_CLIENT_ID="<data-kitchen-api-dev-client-id>" \
  DATABASE_URL="postgresql://${DB_ADMIN}:${DB_PASSWORD}@${DB_SERVER}.postgres.database.azure.com:5432/${DB_NAME}?sslmode=require&connection_limit=5" \
  STORAGE_PROVIDER=azure \
  AZURE_STORAGE_CONNECTION_STRING="<from-storage-account>" \
  ALLOWED_ORIGINS="https://<swa-hostname>" \
  WEBSITES_CONTAINER_START_TIME_LIMIT=600
```

Set `DB_PASSWORD` in the shell session only. Do not commit it, and do not echo it into CI logs.
