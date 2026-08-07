# V1 Foundation — Phase 1 Completion Report

> **Date:** 2026-08-07
> **Environment:** Internal Mirchi Labs development (`datakitchen-dev-rg`, West US 3). NOT customer production.
> **Frontend:** https://datakitchen.mirchilabs.com · **API:** `datakitchen-api-dev.azurewebsites.net`
> **Scope:** Phase 1 foundation only. Phase 2 (Retail Intelligence Library) not started.
> **Supersedes:** the AADSTS50020 blocker section of [DEPLOYMENT_STATUS.md](../deployment/DEPLOYMENT_STATUS.md), which is stale.

---

## 1. Executive summary

The Phase 1 foundation is **functionally complete and verified end to end in the cloud**, with one verification gap and four recorded defects.

Seven imports were executed through the deployed UI by an Entra-authenticated operator across two organizations. All parsed cleanly: **24/24 rows, 0 failures**. Every downstream artefact — blob preservation, canonical products, source records, field provenance, product history, import history, audit log — was verified directly against the production database.

**Referential tenant integrity is clean:** 0 mismatches across 11 products, 7 batches, 24 source records and 172 provenance rows.

The one gap — end-to-end catalog isolation — is **blocked by a UI defect, not by a data-model problem**. The underlying isolation logic was proven directly against live data.

### Final data state

| Entity | Count |
|---|---|
| Organizations | 2 |
| Users | 4 (1 operator + 3 fixtures) |
| Memberships | 4 |
| Catalogs | 4 (2 populated, 2 empty) |
| Import batches | 7 |
| Canonical products | 11 |
| Source records | 24 |
| Field provenance | 172 |
| Product history | 33 |

---

## 2. Status classification

### ✅ Complete

| Item | Evidence |
|---|---|
| Azure infrastructure | 9 resources, West US 3, ~$29/month |
| PostgreSQL network isolation | 45 firewall rules, **all single-IP**, zero broad rules, no "allow all Azure services" |
| Startup migrations | Applied in-container; CI holds no DB credentials; `migrate status` clean |
| Entra authentication | Two app registrations; SPA + resource-server split |
| Auth rejection paths | Anonymous, malformed, wrong-audience (verified with real tenant tokens) → 401 |
| Organization selection | Multi-org operator selects; server re-validates every request |
| Organization switching | Northwind import recorded under org `2222…` after switching |
| **Inactive user** | **403 FORBIDDEN** — "User account not found or inactive" |
| **Inactive membership** | **403 FORBIDDEN** — "No active organization membership" |
| **Cross-org selection refused** | **403 INVALID_ORGANIZATION** — user cannot select a non-member org |
| Unknown Entra identity | 403 FORBIDDEN |
| CSV import | 5 batches |
| JSON import | 1 batch |
| Blob preservation | 7 files in Azure, sizes + SHA checksums recorded |
| Blob tenant isolation | Org-prefixed paths: `organizations/<orgId>/catalogs/<catalogId>/imports/…` |
| Canonical products | 11, values correct after updates |
| Source records | 24, all `success`, **raw payloads byte-preserved** |
| Field provenance | 172 rows with original value, normalized value, and method |
| Product history | 33 rows; **only changed fields recorded** |
| Import history | 7 batches with row counts, status, storage key, checksum |
| Audit log | `import.uploaded` / `confirmed` / `completed` per import, with org + user attribution |
| Cross-organization SKU isolation | MRC-1001/1002/1003 exist independently in both orgs with different brands |
| Referential tenant integrity | 0 mismatches across 214 linked rows |

Authorization results were produced with **dedicated fixtures**; the live operator account was never deactivated. Each negative case is paired with a positive control — the same fixture resolves successfully for its own organization — so the refusals are membership-driven, not incidental failures.

### ⚠️ Partial

**Catalog isolation — logic proven, end-to-end not performed.**

Proven directly against the live database via `findDuplicate()`:

| Probe scope | By SKU | By GTIN |
|---|---|---|
| Same catalog (Mirchi / Import Sandbox) | MATCH | MATCH |
| **Different catalog, same org (Mirchi / Q3 Product Feed)** | **null** | **null** |
| Different org (Northwind / Import Sandbox) | MATCH *(Northwind's own row)* | MATCH *(own row)* |

**Deduplication never crosses catalog boundaries — confirmed.** A Q3 import of `MRC-1001` would create, never update.

Not yet observed end to end: provenance / source records / history / audit attaching to a second catalog within one organization, and non-modification of the first catalog during that import. **This cannot currently be produced through the UI** — see Known Issue KI-1.

### ⏸ Deferred

| Item | Reason |
|---|---|
| Saved mapping templates | Field mappings are per-import and ephemeral. Re-mapping is manual every time. Phase 3 scope. |
| Admin consent for Entra app | Provisioning account holds subscription Owner but no directory role. Per-user consent works. |
| Backend CI/CD deployment | `AZURE_CREDENTIALS` secret absent; deploy step skipped. Backend deployed via `az`. Test job passes. |
| Retailer Readiness, Mapping Studio, Validation & Exceptions, Delivery, Retail Feedback | Phase 2/3 features. Navigation exists; no backend. |
| Clearing semantics for imports | Current behaviour already matches the intended rule — see KI-4. Nothing to implement. |

---

## 3. Known issues

### KI-1 — No catalog selection in the UI *(blocker for catalog-isolation verification)*

**Severity:** High — silently routes data to the wrong catalog.

The catalog is pinned to the first element of the catalog list and never changes:

```ts
// src/pages/IntakePage.tsx:73
const catalogs = await repository.getCatalogs();
if (catalogs.length > 0) {
  setCatalogId(catalogs[0].id);   // setCatalogId is never called again
```

`getCatalogs()` is called in exactly one place, to take `[0]`. The server returns catalogs `orderBy: { createdAt: "desc" }`, so the **most recently created** catalog always wins — here, `Import Sandbox`.

**Consequence:** all 7 imports landed in Import Sandbox regardless of operator intent, including two explicitly aimed at `Q3 Product Feed`. Both `Q3 Product Feed` catalogs remain empty (0 products, 0 batches). This is not operator error — selecting a catalog is impossible in the current build.

**Recommended fix:** add a catalog selector to the workspace header, persist the choice like the organization selection, and surface the target catalog in the import wizard's confirmation step. Until then, catalog isolation cannot be verified end to end through the UI.

### KI-2 — Invalid GTIN values accepted silently

**Severity:** Medium — data-quality defect.

`ABC123INVALID` was written unchanged into the canonical `gtin` field. Provenance shows the normalizer *did* distinguish it (`normalizationMethod: passthrough` versus `direct` for valid values), but no warning was raised and the batch reported `warnedRows = 0`.

Latent risk: `gtin` is `VARCHAR(14)`. `ABC123INVALID` is 13 characters, so it fit. A longer invalid value would surface as a raw database error rather than a validation message.

**Current behaviour:** accept, no warning.
**Recommended future behaviour:** validate GTIN-8/12/13/14 structure and check digit; on failure keep the raw value in the source record, leave the canonical `gtin` null, and raise a row-level warning. **Do not redesign the validation engine yet** — record only.

### KI-3 — Duplicate SKU within a single import merges silently

**Severity:** Medium — UX / data-quality defect.

`Import 08.07 1.txt` contained `SG-HDPH-WHT` on rows 2 and 5. Outcome: `created = 4, updated = 1`, with history written mid-import. The batch reported `warnedRows = 0`.

**Current behaviour:** last-write-wins, no operator signal. The earlier row is silently superseded.
**Recommended future behaviour:** detect duplicate business keys during preview, surface an explicit "N duplicate rows detected — last occurrence wins" warning before confirmation, and count them in `warnedRows`. Keep last-write-wins as the default resolution.

### KI-4 — Attribute and field merge semantics *(behaviour confirmed correct; documented)*

**Severity:** Informational — no code change required.

From [import.service.ts:170-185](../../server/src/services/import.service.ts):

- Core fields are guarded by `if (normalized.<field>)` — an omitted field is never written, so the prior canonical value is preserved.
- Attributes merge shallowly: `{ ...existing.attributes, ...incoming }`, and only when the incoming set is non-empty. Keys absent from a later import persist.

**Confirmed live:** `MRC-1001` still carries `finish: Matte` and `origin_country: US` from the JSON import after two subsequent CSV imports that never mentioned those keys.

**Intended rule** — and the current implementation already satisfies it:
- **Omission = no change.**
- **Explicit null/blank may clear a value only through an explicit, configurable clear policy.** No such policy exists, and no import path clears a value today.

Per instruction, clearing semantics have **not** been implemented, since current code is consistent with the rule.

One nuance for whoever builds that policy: the guard is a truthiness check, not `!== undefined`, so an empty CSV cell is currently indistinguishable from an absent column. That distinction is what a clear policy would need to introduce.

---

## 4. Investigated and closed — `short_description ← title`

**Finding: manual mapping in the import wizard. Not auto-mapping, not alias logic. No defect.**

Determined by replaying `suggestFieldMappings()` against each batch's stored `detectedHeaders` and diffing against the `fieldMappings` actually used:

```
Import 08.07 1.txt
  AUTO  : { sku, gtin, brand, product_name: title, category }
  STORED: { … product_name: title, short_description: title, long_description: description }
  DIFF  : short_description and long_description were ADDED
```

`suggestFieldMappings()` breaks after the first canonical match per header, so a single source column can never auto-map to two canonical fields — and that file contains no `short desc`-style header at all.

Corroborating: the two machine-generated fixtures show `(identical — mapping was NOT hand-edited)`, while `3-northwind-q3.csv` and `4-mirchi-q3-v2-revision.csv` also carry hand-added `long_description` mappings. That explains why some products' long descriptions were populated from the short-description or product-name column.

**No action required.** It does suggest the wizard could warn when one source column is mapped to multiple canonical fields.

---

## 5. Prototype UI cleanup items

Not defects — scaffolding from the pre-backend prototype, still rendering static values. **Cleanup deferred pending discussion.**

| Item | Current state |
|---|---|
| Sidebar "ACTIVE SESSION" | Hardcoded `Product360_Export_2026-07-31.xlsx · 6 products · Walmart schema` |
| Mapping Studio badge | Static `3` |
| Validation & Exceptions badge | Static `12` |
| Retail Feedback badge | Static `8` |
| "STEP 1 OF 6" indicator | Static; no real workflow state |
| Retailer Readiness / Mapping Studio / Delivery / Retail Feedback pages | Navigation present, no backend |

The sidebar reading "6 products" while the workspace correctly reads "No products yet" is this mock data, not a data bug.

---

## 6. Customer-production blockers

Unchanged from the approved infrastructure plan. **This environment is internal development only.**

| Blocker | Detail |
|---|---|
| No private networking | PostgreSQL uses public access with per-IP firewall rules. Networking mode is **permanent at creation** — production must be provisioned VNet-private from the start. |
| No high availability | Single B1ms instance, no replica, no zone redundancy. |
| Backup window | 7-day PITR only. |
| Single app instance | B1, capacity 1, no autoscale. Scale-out is unsafe while startup migrations are in use. |
| No deployment slots | B1 has none. A failed migration means the new revision never serves; there is no staging swap. |
| Secrets in app settings | Connection strings in App Service configuration; no Key Vault, no managed identity. |
| No WAF / Front Door | API is directly internet-reachable, protected only by JWT validation and CORS. |
| App registrations not admin-consented | Per-user consent prompt on first sign-in. |
| Public repository | Source and bundle are world-readable. Verified free of secrets, but worth an explicit decision. |
| No load or concurrency testing | Imports are synchronous and single-instance; behaviour under concurrent imports is unknown. |
| GTIN validation | See KI-2 — invalid identifiers enter canonical data silently. |

---

## 7. Recommended next actions

In priority order, before any Phase 2 work:

1. **Fix KI-1 (catalog selector)** — highest value. Unblocks catalog-isolation verification and prevents silent misrouting of imports.
2. **Re-run catalog isolation** once KI-1 ships: import `1-mirchi-q3-v1.csv` into `Mirchi Labs / Q3 Product Feed` and confirm create-not-update plus non-modification of Import Sandbox.
3. **Address KI-2 (GTIN validation)** — cheapest meaningful data-quality win.
4. **Address KI-3 (duplicate-row warning)** — preview-stage warning only; resolution behaviour unchanged.
5. **Decide on prototype UI cleanup** (section 5).
6. **Remove the `allow-dev-sg` firewall rule** when direct developer database access is no longer needed.
7. **Refresh [DEPLOYMENT_STATUS.md](../deployment/DEPLOYMENT_STATUS.md)** — its AADSTS50020 blocker section is superseded by this report.

---

## 8. Verification method note

Import execution was performed by an authenticated human operator through the deployed UI. All verification of resulting data was performed programmatically against the production PostgreSQL database and Azure Blob Storage.

Authorization scenarios (inactive user, inactive membership, cross-organization selection) were exercised by invoking `AutoTenantResolver` directly against the live database with fixture identities, because those fixtures have synthetic `externalIdentityId` values and no Entra account, so they cannot produce real tokens. The HTTP path from middleware through resolver to error handler is separately evidenced by the live `400 ORGANIZATION_REQUIRED` and `401` responses observed against the deployed API.
