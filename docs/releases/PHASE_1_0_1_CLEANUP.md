# Phase 1.0.1 — Catalog Intake Cleanup

> **Date:** 2026-08-08
> **Commit:** `d600a45` (plus `a1ca4c5` for KI-1, delivered just prior)
> **Environment:** Internal Mirchi Labs development. **Not customer production.**
> **Predecessor:** [V1_FOUNDATION_COMPLETION.md](./V1_FOUNDATION_COMPLETION.md)

**Objective:** make Catalog Intake polished and pleasant for internal operators before Phase 1.1 (PDF Intake) and Phase 2. No new platform capability.

---

## 1. Implemented

### 1.1 Saved mapping templates *(highest priority)*

Operators no longer re-map a recurring export.

**Matching algorithm.** A template is keyed by `(organizationId, sourceType, headerFingerprint)`.

The fingerprint hashes the **normalized header set**: each header is lowercased, trimmed, and runs of non-alphanumerics collapse to `_`; the set is de-duplicated and **sorted** before hashing. Two consequences follow deliberately:

- **Column order does not matter.** The same export matches even if columns move.
- **Casing and separator style do not matter.** `Product Name`, `product_name` and `PRODUCT-NAME` are the same column.

Matching then runs in two tiers:

| Tier | Condition | Behaviour |
|---|---|---|
| **Exact** | Fingerprint equality | The whole mapping applies. The wizard shows *"Existing mapping applied."* and **Continue** goes straight to import. **Review Mapping** opens the mapping screen if wanted. Highest version wins. |
| **Partial** | Same `(org, sourceType)`, overlapping headers | Every stored mapping whose source column still exists is pre-applied. Only **new** and **missing** columns are named. |
| None | No overlap | Normal alias-based auto-detection |

Partial candidates are ranked by **how many columns they resolve**, then coverage ratio, then version. Ranking by ratio alone would let a template mapping one column tie with one mapping six.

On an exact match the stored mapping is **re-pointed to the uploaded file's actual header spellings**, so a template saved against `title` still applies to a file with `Title`.

**Saving.** After a successful import the confirmed mapping is saved. An identical mapping refreshes the existing row rather than creating a version; a changed mapping becomes a new version. `templateMode: "replace"` overwrites the newest instead. Saving is **best-effort** — a template failure never fails an import that already succeeded.

Templates are scoped per organization and never shared across tenants.

**Schema.** One new table, `mapping_template`. Additive only; no existing model altered.

### 1.2 Import validation — resolves KI-2

`import-validation.ts` checks product identifiers:

- GTIN missing
- GTIN not numeric *(the original `ABC123INVALID` case)*
- GTIN of unsupported length — 8, 12, 13, 14 are valid
- GTIN failing its GS1 mod-10 check digit
- A `upc`-named source column that is not exactly 12 digits

Every issue is a **warning**. The row imports, the product is created, but it is marked `needs_review`, the warning appears in the import summary, and the issue is persisted in the batch's `errorSummary`. **Batches are never rejected**, and the raw value stays untouched in the source record.

This is not the Validation Engine — identifiers only, no configurable rules, no retailer requirements.

### 1.3 Duplicate SKU warning — resolves KI-3

Repeated business keys are detected during preview and reported with the SKU, occurrence count, exact row numbers, the winning row, and which rows will be superseded:

```
Duplicate SKU detected
SKU SG-HDPH-WHT appears 2 times.
Rows: 2, 5
Resolution: row 5 will overwrite row 2.
```

**Merge behaviour is unchanged** — last occurrence still wins. The defect was the silence, not the resolution.

Detection runs over the **whole file**. `preview.sampleRows` is only the first 20 rows, so scanning it would have understated the warning; `uploadAndPreview` now exposes the full row set server-side for this check. That set is never returned to the client.

### 1.4 Import summary

Replaces "Import Successful" with Products Created, Products Updated, Warnings, Errors, Skipped, Duration, Catalog, Organization, Source file, and Import ID — plus whether a mapping template was saved or updated. Actions are **Open Catalog** and **Import Another File**. Validation warnings and errors are listed with their row numbers.

### 1.5 Prototype UI cleanup

Removed from the live workspace:

| Artifact | Replacement |
|---|---|
| "Active Session — `Product360_Export_2026-07-31.xlsx`, 6 products · Walmart schema" | Real active **Organization**, or nothing |
| Mapping Studio badge `3` | Removed |
| Validation & Exceptions badge `12` | Removed |
| Retail Feedback badge `8` | Removed |
| Unbuilt destinations presented as working | **"Not available yet"** label |

Demo-mode fixtures (`seed-data.ts`, `mapping-data.ts`, `feedback-data.ts`) are **retained deliberately** — they back demo mode when the API is unreachable, and removing them would break it. They are never shown in live mode.

---

## 2. Known issues

| ID | Issue | Severity |
|---|---|---|
| — | None introduced by this sprint | — |

Carried forward and unchanged:

**KI-4 — merge semantics.** Omission preserves the prior value; there is no way to clear a field via import. Current code already matches the intended rule, so nothing was implemented. The guard is a truthiness check rather than `!== undefined`, so an empty CSV cell is indistinguishable from an absent column — that distinction is what a future clear-policy must introduce.

**Migration note.** `prisma migrate dev` proposed `ALTER COLUMN "id" DROP DEFAULT` on **all ten** pre-existing tables plus two index renames. These are artifacts of a newer Prisma emitting client-side UUIDs, and would have stripped database-level `gen_random_uuid()` defaults that non-Prisma insert paths rely on. They were **excluded**; the migration creates one table and nothing else. Verified post-deploy that defaults remain intact on `organization`, `user`, `catalog` and `canonical_product`.

---

## 3. Deferred

Requested behaviour that belongs to later phases, documented rather than built:

| Item | Phase | Note |
|---|---|---|
| PDF intake | 1.1 | Not started |
| Retail Intelligence Library | 2 | Not started |
| Mapping Engine (transforms, retailer targets, versioned rules) | 3 | Saved templates here are *column mappings only* — no transformation logic |
| Validation Engine (configurable rules, retailer requirements, readiness scoring) | 2/3 | This sprint validates identifiers only |
| Delivery, Retail Feedback | 3+ | Navigation present, labelled unavailable |
| Clear-on-blank import semantics | TBD | Requires an explicit configurable policy — see KI-4 |
| Template management UI (rename, delete, browse versions) | TBD | Templates are currently created and matched automatically, with no browse screen |
| Product Detail restructure, Catalog Workspace polish | **Partially delivered** | See §6 |

---

## 4. Testing

| Suite | Result |
|---|---|
| Backend unit + integration | **149 passed** (13 files) |
| Frontend | **21 passed** |
| Frontend typecheck | ✅ clean |
| Backend typecheck | ✅ clean |
| Production build | ✅ exit 0, no `DEV_AUTH_TOKEN` in bundle |
| Lint (`src/`) | ✅ 0 issues |

**39 new backend cases** in this sprint:

- **Validation (13)** — check digit at each valid length, wrong check digit, non-numeric, unsupported length, missing, UPC length rule, upc-like column detection, and an assertion that **no issue is ever blocking**.
- **Duplicate detection (11)** — the real KI-3 case from `Import 08.07 1.txt` (rows 2 and 5), row ordering, trimming, case sensitivity, blank keys, mapped-header indirection, multiple groups, overwritten-row counting.
- **Template matching (15)** — fingerprint stability, order independence, casing independence, add/remove sensitivity, exact match re-pointing to actual header spellings, version preference, source-type isolation, partial pre-application, new/missing header reporting, coverage ranking, and no-match behaviour.

**Live verification on Azure.** Backend redeployed and healthy (`database: connected`); SWA deploy succeeded; the served bundle contains *Existing mapping applied*, *Duplicate SKU detected*, *Review Mapping*, *Products Created*, *Import Another File*, and *Not available yet*; `mapping_template` is queryable in the cloud database.

**Not yet exercised end to end by a human:** an actual repeat import demonstrating an exact-match skip, and an invalid-GTIN import showing the warning in the live summary. Both are covered by unit tests and are deployed, but neither has been driven through the browser. See §8.

---

## 5. Screenshots

None captured. Every UI change was verified by asserting on strings in the deployed bundle rather than visually. Operator walkthrough with screenshots is best produced alongside the §8 acceptance run.

---

## 6. Partially delivered

Stated plainly rather than claimed complete:

- **Product Detail (item 6)** — provenance already renders as a table with current value, source, import, method and last-updated, and history is already chronological. No restructuring was performed this sprint.
- **Catalog Workspace polish (item 7)** — improved empty states (no-catalogs, needs-selection) and the removal of stale data on catalog switch landed via KI-1. Sticky filters and remembered search/filter state were **not** implemented.

Both are low-risk and can complete in a short follow-up.

---

## 7. Architecture impact

**None to the protected areas.** Multi-tenancy, authentication, Azure infrastructure, the Canonical Product Model, the import pipeline, provenance, history, audit, and Blob Storage are all unchanged.

| Change | Nature |
|---|---|
| `mapping_template` table | **Additive.** One new table + FK to `organization`. No existing table altered. |
| `ImportResults` | Additive fields — `validationIssues`, `skippedRows`, `durationMs`, `filename`, `catalogId`, `organizationId` |
| `UploadResult.allRows` | Server-side only; never serialized to the client |
| Upload response | Additive — `templateMatch`, `duplicates` |
| Confirm request | Optional `templateMode` |
| `dataQualityStatus` | Now also set to `needs_review` on an identifier warning. Existing statuses unchanged. |

Imports behave exactly as before when no template matches and no identifier is invalid.

---

## 8. Recommendation on declaring Phase 1.0.1 complete

**Not yet — pending one short acceptance run.**

Everything requested is implemented, tested, built and deployed, and the two known defects it targeted (KI-2, KI-3) are resolved. But two headline behaviours have only been proven by unit test, never observed by a person in the live system:

1. **Repeat import** of a previously imported file — should show *"Existing mapping applied."* and skip the mapping screen.
2. **Import a file containing `ABC123INVALID`** — should succeed, create the product, mark it **Needs Review**, and list the warning in the summary.

Given this sprint exists precisely because silent behaviour caused seven misrouted imports, confirming these two visibly is worth the ten minutes. Two items are also **partially delivered** (§6) and should either be finished or explicitly accepted as-is.

**Recommendation:** run the two checks above; if both behave as described, declare Phase 1.0.1 complete with §6 accepted as a known gap, and proceed to Phase 1.1.

---

## 9. Release notes

**Data Kitchen — Catalog Intake 1.0.1**

- **Saved mappings.** Re-importing a familiar file no longer asks you to map columns again. Column order and capitalisation can change and it will still be recognised. New columns are the only thing you are asked about.
- **Identifier checks.** Invalid or missing GTINs are now flagged instead of being accepted quietly. The import still succeeds and the product is still created — it is marked *Needs Review* so you can find it.
- **Duplicate warnings.** If the same SKU appears twice in one file you are told which rows are involved and which one wins, before you commit.
- **Better import summary.** Created, updated, warnings, errors, skipped, duration, destination, source file, and import ID.
- **Honest UI.** Placeholder session details and invented badge counts are gone. Features that do not exist yet say so.

Upgrade notes: one additive database migration. No configuration changes. No behaviour changes to existing imports.
