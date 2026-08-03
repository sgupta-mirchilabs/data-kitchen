# Deployment Status — Internal Development Environment

> **Checkpoint:** 2026-08-03
> **Environment:** Internal Mirchi Labs development. NOT customer production.
> **Full plan:** [AZURE_INFRASTRUCTURE.md](./AZURE_INFRASTRUCTURE.md)

---

## Summary

Backend is **provisioned, deployed, and serving**. Authentication rejects unauthorized callers correctly. Frontend is **not deployed**. End-to-end import validation is **not complete** — it requires an interactive Entra sign-in that must be performed by a person.

| Area | Status |
|---|---|
| Azure resources | ✅ Provisioned |
| Entra app registrations | ✅ Created (admin consent pending) |
| Database migrations | ✅ Applied |
| Backend deployment | ✅ Live, health 200 |
| Auth rejection paths | ✅ Verified live (5 checks) |
| Auth acceptance paths | ⛔ Blocked — needs interactive sign-in |
| Frontend deployment | ⛔ Not deployed |
| End-to-end import | ⛔ Not run |

---

## Provisioned resources

Region **West US 3**, resource group `datakitchen-dev-rg`.

| Resource | Name | Notes |
|---|---|---|
| App Service Plan | `datakitchen-dev-plan` | B1 Linux, capacity **1**, no autoscale |
| App Service | `datakitchen-api-dev` | `NODE:22-lts`, HTTPS-only, Always On, FTPS disabled |
| PostgreSQL | `datakitchen-db-dev` | v16, B1ms, 32 GB, autogrow off, TLS required |
| Database | `datakitchen` | 3 migrations applied |
| Storage Account | `datakitchenstordev` | Standard LRS, public blob access disabled, min TLS 1.2 |
| Blob container | `imports` | Private |
| Log Analytics | `datakitchen-logs-dev` | — |
| Application Insights | `datakitchen-insights-dev` | Workspace-based |
| Static Web App | `data-kitchen` | Pre-existing, `mirchi-data-kitchen` / West US 2 |

**Endpoint:** `https://datakitchen-api-dev.azurewebsites.net` — `/api/v1/health` returns `{"status":"ok","database":"connected"}`.

**Cost:** ~$29/month. No free-service benefit applies — the subscription is Pay-As-You-Go (`PayAsYouGo_2014-09-01`), not an Azure free account. No VS / Startups / Partner credits present.

---

## Entra ID

| Registration | Role |
|---|---|
| `data-kitchen-api-dev` | Resource server. `api://<api-id>`, scope `access_as_user`, `requestedAccessTokenVersion: 2`. No secret. |
| `data-kitchen-web-dev` | SPA public client. PKCE, redirect URIs `http://localhost:5173` + SWA host. Delegated `access_as_user`. No secret. |

Backend validates `aud` against the **API** registration only. Client IDs are recorded in App Service settings and are not duplicated here.

⚠️ **Admin consent not granted.** The provisioning account holds subscription Owner but no Entra directory role, so tenant-wide consent was refused (`Authorization_RequestDenied`). The scope is user-consentable, so sign-in works with a one-time per-user prompt. A Global Administrator or Cloud Application Administrator can grant consent to remove it.

---

## PostgreSQL networking

**45 firewall rules — every one a single IP. Zero broad rules.**

- 44 × `allow-appservice-*` — one per distinct App Service `possibleOutboundIpAddresses` entry (full coverage verified)
- 1 × `allow-dev-sg` — one explicitly approved developer IP

No `0.0.0.0` rule, no "allow all Azure services" rule, no GitHub runner ranges.

⚠️ **`--public-access None` did not behave as documented.** It set `publicNetworkAccess: Disabled` outright rather than "public mode with zero rules", and all firewall calls were rejected:

```
ERROR: Firewall rule operations cannot be requested for a server that doesn't have public access enabled.
```

The server was not VNet-injected — it simply had no reachable endpoint. Corrected non-destructively:

```bash
az postgres flexible-server update -g datakitchen-dev-rg -n datakitchen-db-dev --public-access Enabled
```

This enables the endpoint **without creating any firewall rule**, which is the intended deny-by-default state. Verified `Enabled` + rule count 0 before adding per-IP rules. Always run this verification after creation.

---

## Migrations

Applied by `server/startup.sh` inside the app container, which holds a firewall allowance. `prisma migrate status` reports *"Database schema is up to date!"* (3 migrations).

CI holds no `DATABASE_URL` and never connects to the database.

Failure behaviour is unchanged: `set -euo pipefail` aborts before the server binds a port, so a failed migration means the new revision never serves and the previous one keeps running. No automatic rollback.

---

## Verification results

**Passing live against the deployed endpoint:**

| Check | Result |
|---|---|
| Health endpoint public | 200 |
| Anonymous request | 401 |
| Malformed token | 401 |
| Garbage JWT-shaped token | 401 |
| Real Mirchi tenant token, Graph audience | 401 |
| Real Mirchi tenant token, ARM audience | 401 |

The last two used genuine, validly-signed Entra tokens from the Mirchi Labs tenant — rejected purely on audience.

**Passing as automated tests:** backend suite **103/103** (13 new `EntraAuthProvider` cases covering wrong tenant, wrong audience, expired, untrusted key, missing `oid`, and claim mapping). Frontend production build compiles clean and contains **no `DEV_AUTH_TOKEN` string**.

**Not yet verified:** wrong-tenant / expired / valid-user / inactive-user / inactive-membership / organization-selection against the live endpoint; frontend sign-in and logout; import pipeline; provenance, history, audit logs; live cross-tenant rejection; Application Insights telemetry.

---

## Seed data

`server/prisma/bootstrap-cloud.ts` (guarded by `ALLOW_CLOUD_BOOTSTRAP=true`) created:

- **2 organizations** — Mirchi Labs, Northwind Test Co
- **3 users** — one real operator keyed to their Entra `oid`, plus inactive-user and inactive-membership fixtures
- **3 memberships** — operator is `organization_admin` in both orgs, so organization selection is exercised
- **4 catalogs** — `production` and `test` in each org, with deliberately overlapping names across tenants

Separate from `prisma/seed.ts`, which is intentionally guarded against non-local databases and hardcodes a development identity meaningless under Entra.

---

## Blocked — needs a person

1. **Interactive Entra sign-in.** A real API-scoped access token requires a browser sign-in with a Mirchi Labs account. Needed for the remaining acceptance checks and the entire import flow.
2. **GitHub secrets and variables.** `gh` CLI is not installed. Required before CI can deploy:
   - Secrets: `AZURE_CREDENTIALS`, `AZURE_STATIC_WEB_APPS_API_TOKEN_ICY_STONE_00F10FB1E`
   - Variables: `AZURE_BACKEND_APP_NAME`, `VITE_API_BASE_URL`, `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID` (SPA), `VITE_ENTRA_API_SCOPE` (API)
3. **Frontend deployment.** Either wire up the SWA token above, or approve a direct `az` deployment.

---

## Deployment packaging gotchas

Recorded because each cost a failed deployment:

1. **Basic publishing credentials are disabled** (secure default, left as-is). `az webapp deploy` and any Kudu basic-auth call fail. Use a bearer token against `/api/zipdeploy`.
2. **Oryx runs `npm run build` whenever a `build` script exists.** Shipping prebuilt `dist/` without `src/` or `tsconfig.json` made `tsc` print help and exit non-zero — reported only as `Deployment Failed` with `Errors (0)`. Fix: omit `build` and test scripts from the **shipped** `package.json` (repo copy unchanged). The real error is only in the Oryx detail log via `details_url` on the `Running oryx build...` entry.
3. **Zip archives need POSIX separators.** PowerShell `Compress-Archive` writes `\` separators Kudu cannot extract. Use Python `zipfile`, and set mode `0o755` on `startup.sh`.
4. **`prisma` moved to `dependencies`** — `startup.sh` invokes the CLI after a production-only install.

---

## Known deviations from the approved plan

1. **Node 22, not Node 20** — App Service Linux offers only `NODE:22-lts` and `NODE:24-lts`; Node 20 reached EOL April 2026.
2. **`--public-access None` required correction** — see above.
3. **Admin consent not granted** — per-user consent instead.
4. **Frontend and backend in different resource groups and regions** — pre-existing SWA in `mirchi-data-kitchen` / West US 2. The SPA is CDN-served and reaches the API over HTTPS with CORS; no functional impact.

---

## Cleanup reminder

Remove `allow-dev-sg` when direct developer database access is no longer needed:

```bash
az postgres flexible-server firewall-rule delete -g datakitchen-dev-rg --name datakitchen-db-dev --rule-name allow-dev-sg --yes
```

---

## Customer-production blockers

Unchanged: no VNet private access (PostgreSQL networking mode is permanent at creation — production should be provisioned private from the start), no HA, 7-day PITR only, single instance, no managed identity (connection strings in app settings), no WAF or Front Door, no staging slot on B1, app registrations not admin-consented.
