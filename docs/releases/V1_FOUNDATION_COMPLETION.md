# V1 Foundation — Phase 1 Completion Report

> **Date:** 2026-08-07 (updated after KI-1 resolution)
> **Environment:** Internal Mirchi Labs development (`datakitchen-dev-rg`, West US 3). NOT customer production.
> **Frontend:** https://datakitchen.mirchilabs.com · **API:** `datakitchen-api-dev.azurewebsites.net`
> **Scope:** Phase 1 foundation only. Phase 2 (Retail Intelligence Library) not started.
> **Supersedes:** the AADSTS50020 blocker section of [DEPLOYMENT_STATUS.md](../deployment/DEPLOYMENT_STATUS.md), which is stale.

---

## 1. Executive summary

The Phase 1 foundation is **functionally complete and verified end to end in the cloud**. The one outstanding verification gap — catalog isolation — was closed on 2026-08-07 after resolving KI-1; three known issues remain open, none blocking.

Eight imports were executed through the deployed UI by an Entra-authenticated operator across two organizations and three catalogs. All parsed cleanly: **28/28 rows, 0 failures**. Every downstream artefact — blob preservation, canonical products, source records, field provenance, product history, import history, audit log — was verified directly against the production database.

**Referential tenant integrity is clean:** 0 mismatches across 15 products and 8 batches.

Catalog isolation is now **verified end to end**: an import into a second catalog created new products, left the first catalog byte-identical, and attached every provenance, source and audit row to the correct catalog.

### Final data state

| Entity | Count |
|---|---|
| Organizations | 2 |
| Users | 4 (1 operator + 3 fixtures) |
| Memberships | 4 |
| Catalogs | 4 (3 populated, 1 empty) |
| Import batches | 8 |
| Canonical products | 15 |
| Source records | 28 |
| Field provenance | 200 |
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
| CSV import | 7 batches |
| JSON import | 1 batch |
| Blob preservation | 8 files in Azure, sizes + SHA checksums recorded |
| Blob tenant isolation | Org-prefixed paths: `organizations/<orgId>/catalogs/<catalogId>/imports/…` |
| Canonical products | 15, values correct after updates |
| Source records | 28, all `success`, **raw payloads byte-preserved** |
| Field provenance | 200 rows with original value, normalized value, and method |
| Product history | 33 rows; **only changed fields recorded** |
| Import history | 8 batches with row counts, status, storage key, checksum |
| Audit log | `import.uploaded` / `confirmed` / `completed` per import, with org + user attribution |
| Cross-organization SKU isolation | MRC-1001/1002/1003 exist independently in both orgs with different brands |
| Referential tenant integrity | 0 mismatches across 251 linked rows |

Authorization results were produced with **dedicated fixtures**; the live operator account was never deactivated. Each negative case is paired with a positive control — the same fixture resolves successfully for its own organization — so the refusals are membership-driven, not incidental failures.

### ✅ Complete — catalog isolation *(closed 2026-08-07, after KI-1 was resolved)*

Verified end to end by importing `1-mirchi-q3-v1.csv` into **Mirchi Labs / Q3 Product Feed** through the deployed UI, against a baseline snapshot of Import Sandbox captured immediately beforehand.

| Check | Result |
|---|---|
| Import landed in the intended catalog | ✅ `Q3 Product Feed [production]`, 4/4 rows, 0 failed |
| **Created, not updated** | ✅ `createdProducts: 4, updatedProducts: 0` |
| Blob path scoped to the target catalog | ✅ key contains the Q3 catalog id |
| Same SKU independent across catalogs, same org | ✅ MRC-1001/1002/1003/1004 each hold 2 distinct Mirchi rows in 2 catalogs |
| Same SKU across all tenants | ✅ MRC-1001 exists as 3 distinct products across 3 catalogs |
| **Import Sandbox unmodified** | ✅ 8 products **byte-identical, including `updatedAt`** |
| Provenance attached to the correct catalog | ✅ 28 rows, **0** sourced outside Q3 |
| Source records attached to the correct catalog | ✅ 4 rows, **0** pointing outside Q3 |
| Import history is catalog-specific | ✅ Q3 = 1 batch, Sandbox = 6 batches |
| Audit trail | ✅ `import.uploaded` records the Q3 catalog id; `import.completed` records 4 created / 0 updated |
| No cross-organization leakage | ✅ 0 mismatches across 15 products and 8 batches |

Supporting code-level evidence from `findDuplicate()` probes against live data — match within the same catalog, **null** for a different catalog in the same organization — is consistent with the observed create-not-update behaviour.

That Q3 shows **0 history rows** is itself confirmation: every row was a fresh insert, so nothing was overwritten.

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

### KI-1 — No catalog selection in the UI — ✅ **RESOLVED** *(commit `a1ca4c5`, 2026-08-07)*

**Original severity:** High — silently routed data to the wrong catalog.

**Defect as found.** The catalog was pinned to the first element of the catalog list and never reassigned:

```ts
// src/pages/IntakePage.tsx:73 (before)
const catalogs = await repository.getCatalogs();
if (catalogs.length > 0) {
  setCatalogId(catalogs[0].id);   // setCatalogId was never called again
```

`getCatalogs()` was called in exactly one place, to take `[0]`. The server returns catalogs `orderBy: { createdAt: "desc" }`, so the most recently created catalog always won — `Import Sandbox`. All 7 imports up to that point landed there regardless of intent, including two aimed at `Q3 Product Feed`. Selecting a catalog was impossible in that build; this was never operator error.

**Resolution.** An always-visible catalog selector now sits in the workspace header beside the active organization, with a `catalog_type` badge (production highlighted). The selection rules live in `src/lib/catalog-selection.ts`, free of React so they are directly testable:

| Situation | Behaviour |
|---|---|
| No catalogs | Imports blocked, explanatory empty state |
| Exactly one catalog | Auto-selected — unambiguous, not a guess |
| Several + valid stored choice | Restored |
| Several + no valid stored choice | **Explicit selection required** |

- Selection persists per organization under `data-kitchen:selected-catalog:<organizationId>`.
- A stored id is honoured **only** if it is still one of that organization's catalogs; stale or cross-organization ids are discarded. The stored value is never treated as authorization — the server continues to enforce catalog ownership from tenant context on every request.
- Switching catalogs clears products, stats, import history and product selection **before** refetching, so the previous catalog's rows are never shown against the new one.
- The import wizard displays its destination catalog; imports are blocked when none is selected.

**Remaining `catalogs[0]` occurrences:** exactly one, and it is justified —

```ts
// src/lib/catalog-selection.ts:42
if (catalogs.length === 1) return { status: "auto-selected", catalogId: catalogs[0].id };
```

guarded by `length === 1`, where there is nothing to choose. No hardcoded catalog ids remain in shipped code, and every `catalogId` consumer receives it explicitly as a parameter or prop.

**Tests:** 21 frontend cases (auto-select, needs-selection, restore, stale-id discard, per-organization isolation, organization-switch context change, cross-organization id refusal, type labelling — including an explicit assertion that several catalogs never resolve to the first) and 7 backend cases proving `findDuplicate` constrains every lookup by `catalogId`.

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

1. ~~Fix KI-1 (catalog selector)~~ — **done**, commit `a1ca4c5`.
2. ~~Re-run catalog isolation~~ — **done**, passed all checks.
3. **Address KI-2 (GTIN validation)** — cheapest meaningful data-quality win.
4. **Address KI-3 (duplicate-row warning)** — preview-stage warning only; resolution behaviour unchanged.
5. **Decide on prototype UI cleanup** (section 5).
6. **Remove the `allow-dev-sg` firewall rule** when direct developer database access is no longer needed.
7. **Refresh [DEPLOYMENT_STATUS.md](../deployment/DEPLOYMENT_STATUS.md)** — its AADSTS50020 blocker section is superseded by this report.

---

## 8. Verification method note

Import execution was performed by an authenticated human operator through the deployed UI. All verification of resulting data was performed programmatically against the production PostgreSQL database and Azure Blob Storage.

Authorization scenarios (inactive user, inactive membership, cross-organization selection) were exercised by invoking `AutoTenantResolver` directly against the live database with fixture identities, because those fixtures have synthetic `externalIdentityId` values and no Entra account, so they cannot produce real tokens. The HTTP path from middleware through resolver to error handler is separately evidenced by the live `400 ORGANIZATION_REQUIRED` and `401` responses observed against the deployed API.
