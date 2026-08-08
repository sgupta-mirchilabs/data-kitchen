# Deferred Backlog

> **Single source of truth for intentionally postponed work.**
>
> When work is deliberately deferred, it is recorded here — not left in conversation history.
> Companion to [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md), which tracks phases; this tracks items pushed out of them.

**Last updated:** 2026-08-08

---

## How to use this document

Add an entry the moment work is deferred, while the reasoning is still fresh. The **Reason deferred** field matters most — it is what stops the same debate being reopened later.

**Status values:** `Backlog` · `Scheduled` · `In Progress` · `Done` · `Dropped`
**Priority:** `P1` (next phase) · `P2` (planned) · `P3` (opportunistic) · `P4` (idea only)

IDs are permanent. A dropped item keeps its ID with `Status: Dropped` and a note, so it is not silently resurrected.

---

## Summary

| ID | Title | Target phase | Priority | Status |
|---|---|---|---|---|
| DB-001 | Saved Mapping Templates management UI | 1.0.2 | **P1** | Backlog |
| DB-002 | Product Detail UX improvements | 1.0.2 | P2 | Backlog |
| DB-003 | Catalog Workspace polish — sticky filters, search, preferences | 1.0.2 | P2 | Backlog |
| DB-004 | PDF Intake | 1.1 | **P1** | Scheduled |
| DB-005 | Retail Intelligence enhancements | 2 | P2 | Backlog |
| DB-006 | Additional validation rules discovered during onboarding | 4 | P2 | Backlog |
| DB-007 | Advanced mapping intelligence — AI mapping, supplier profiles | 3 | P3 | Backlog |
| DB-008 | Clear-on-blank import semantics | TBD | P3 | Backlog |
| DB-009 | Backend CI/CD deployment via GitHub Actions | 1.0.2 | P2 | Backlog |
| DB-010 | Entra admin consent | TBD | P3 | Backlog |
| DB-011 | Asynchronous / large-file imports | TBD | P2 | Backlog |
| DB-012 | Product edit and delete in the UI | TBD | P2 | Backlog |
| DB-013 | Import staging layer (ImportStagingRecord) | TBD | P3 | Backlog |
| DB-014 | Streaming parse from Blob Storage | TBD | P2 | Backlog |
| DB-015 | External queue (Service Bus) for imports | TBD | P3 | Backlog |
| DB-016 | Multi-instance import workers | TBD | P3 | Backlog |

---

## DB-001 — Saved Mapping Templates management UI

**Description.** A read-only (later editable) view of saved mapping templates for the active organization: source type, version, mapped column count, header list, last updated, and which imports used it. Later: rename, delete, and browse version history.

**Reason deferred.** Phase 1.0.1 delivered template creation and matching, which is where the operator time saving lives. The management surface is additive and was not needed to prove the mechanism works.

**Current phase:** 1.0.1 (feature shipped without UI) · **Target phase:** 1.0.2 · **Priority:** P1

**Dependencies.** None. `mapping_template` already exists and is queried per organization.

**Status:** Backlog

**Note.** Raised directly by the operator during the 1.0.1 acceptance run. A template silently shapes every future import of a matching file — the `manufacturer ← brand` mapping in the current dev template is a live example of a deliberate choice that is now invisible. Today the only ways to inspect it are starting an import and clicking **Review Mapping**, or querying the database. This is the strongest P1 in the list.

---

## DB-002 — Product Detail UX improvements

**Description.** Group canonical fields into logical sections; tighten the provenance table; make the history timeline easier to scan.

**Reason deferred.** Assessed during 1.0.1: provenance already renders as a table with current value, source, import, method and last-updated, and history is already chronological. The remaining work is readability, not missing capability, so it did not justify restructuring a working screen mid-sprint.

**Current phase:** 1.0.1 (partially delivered) · **Target phase:** 1.0.2 · **Priority:** P2

**Dependencies.** None.

**Status:** Backlog

---

## DB-003 — Catalog Workspace polish: sticky filters, search, preferences

**Description.** Sticky filter bar on scroll; remember search text and status filter across navigation and reloads; persist per-operator view preferences.

**Reason deferred.** 1.0.1 delivered the correctness-critical parts of workspace polish — clearer empty states and clearing stale data on catalog switch. Sticky filters and remembered state are convenience only and were explicitly not implemented.

**Current phase:** 1.0.1 (partially delivered) · **Target phase:** 1.0.2 · **Priority:** P2

**Dependencies.** None. Would reuse the per-organization sessionStorage pattern from catalog selection.

**Status:** Backlog

---

## DB-004 — PDF Intake

**Description.** Accept PDF product documents (spec sheets, line sheets, catalogues) as an import source, extracting structured product data into the same canonical pipeline.

**Reason deferred.** Phase 1 deliberately scoped intake to structured formats (CSV, JSON) to prove the canonical model, provenance and history end to end before adding extraction uncertainty.

**Current phase:** — · **Target phase:** 1.1 · **Priority:** P1

**Dependencies.** Phase 1 complete (done). Provenance model must represent lower-confidence extracted values — the existing `normalizationMethod` and `confidence`-style fields are the likely extension point.

**Status:** Scheduled — next phase

---

## DB-005 — Retail Intelligence enhancements

**Description.** Retailer profiles, attribute libraries, validation rule sets, reference data, and readiness scoring — the knowledge layer that encodes what each retailer requires.

**Reason deferred.** Phase 2 in its own right, not a deferral from Phase 1. Recorded here so enhancement ideas raised during Phase 1 operation are not lost.

**Current phase:** — · **Target phase:** 2 · **Priority:** P2

**Dependencies.** Canonical product model (done). Readiness scoring queries canonical products against retailer schemas.

**Status:** Backlog

---

## DB-006 — Additional validation rules discovered during onboarding

**Description.** Rules beyond identifier checks: required-field completeness, category taxonomy validity, image dimension and format requirements, unit and measurement sanity, per-retailer conditional requirements.

**Reason deferred.** Phase 1.0.1 deliberately implemented **lightweight identifier validation only** (GTIN/UPC format, length, check digit, missing). Anything configurable or retailer-specific belongs to the Validation Engine; building it early would pre-commit its architecture.

**Current phase:** 1.0.1 (identifiers only) · **Target phase:** 4 · **Priority:** P2

**Dependencies.** DB-005 — retailer requirements must be modelled before they can be validated against.

**Status:** Backlog — collect real cases during onboarding and append them here as they are found

---

## DB-007 — Advanced mapping intelligence

**Description.** AI-assisted mapping suggestions, supplier profiles that carry mapping conventions across files, transformation rules (concatenation, lookups, unit conversion, conditional logic), and reusable mappings shared across catalogs.

**Reason deferred.** Phase 1.0.1 saved mapping templates are **column mappings only** — no transformation logic. Transformations are the Mapping Engine's remit.

**Current phase:** 1.0.1 (column mappings only) · **Target phase:** 3 · **Priority:** P3

**Dependencies.** DB-001 (a management surface should exist before mappings get more complex). DB-005 for retailer-target mappings.

**Status:** Backlog

---

## DB-008 — Clear-on-blank import semantics

**Description.** An explicit, configurable policy allowing an import to clear a canonical value, distinct from omitting the column.

**Reason deferred.** Current behaviour — omission preserves the prior value, and no import path clears a value — already matches the agreed rule, so nothing needed implementing. Introducing clearing without a deliberate policy risks silent data loss.

**Current phase:** — · **Target phase:** TBD · **Priority:** P3

**Dependencies.** None technically. Requires a product decision on the policy.

**Status:** Backlog

**Note.** The current guard is a truthiness check rather than `!== undefined`, so an empty CSV cell is indistinguishable from an absent column. Making that distinction is the first implementation step. Recorded as KI-4 in [V1_FOUNDATION_COMPLETION.md](./releases/V1_FOUNDATION_COMPLETION.md).

---

## DB-009 — Backend CI/CD deployment via GitHub Actions

**Description.** Add the `AZURE_CREDENTIALS` secret (service principal scoped to `datakitchen-dev-rg`) so the backend workflow's deploy step runs instead of failing at `azure/login`.

**Reason deferred.** The backend is deployed directly via `az` and the workflow's **test job passes**; only the deploy step is skipped, so nothing is silently broken. Creating and storing a service principal credential is an owner decision.

**Current phase:** 1 · **Target phase:** 1.0.2 · **Priority:** P2

**Dependencies.** Owner must create the service principal — the credential should not be generated or printed by tooling.

**Status:** Backlog

---

## DB-010 — Entra admin consent

**Description.** Grant tenant-wide admin consent for `data-kitchen-web-dev` so operators are not prompted individually at first sign-in.

**Reason deferred.** The provisioning account holds subscription Owner but no Entra directory role, so consent was refused (`Authorization_RequestDenied`). The scope is user-consentable, so sign-in works with a one-time per-user prompt.

**Current phase:** 1 · **Target phase:** TBD · **Priority:** P3

**Dependencies.** A Global Administrator or Cloud Application Administrator must perform it.

**Status:** Backlog

---

## DB-011 — Asynchronous / large-file imports

**Description.** Move imports off the request thread so files beyond the current 50 MB / 10,000-row limits can be processed without holding the browser tab open.

**Reason deferred.** Synchronous import is adequate at internal scale and keeps the pipeline simple while the canonical model is still settling.

**Current phase:** 1 · **Target phase:** TBD · **Priority:** P2

**Dependencies.** Would interact with the single-instance constraint — scale-out is currently unsafe while startup migrations are in use.

**Status:** Backlog

---

## DB-012 — Product edit and delete in the UI

**Description.** Correct or remove a product without re-importing.

**Reason deferred.** Phase 1 is import-only by design. Editing needs a considered provenance story — a manual edit has no source record, so the provenance model must represent operator-originated values distinctly.

**Current phase:** 1 · **Target phase:** TBD · **Priority:** P2

**Dependencies.** Provenance model extension. Interacts with DB-008.

**Status:** Backlog

**Note.** Currently there is no way to remove products imported into the wrong catalog through the UI — relevant now that catalog selection is explicit but mistakes remain possible. This absence is also why the Phase 1.0.1 preview warns before overwriting existing products: without an undo, the warning is the only safeguard.


---

## DB-013 - Import staging layer (ImportStagingRecord)

**Description.** A persisted working table of normalized rows with projected action, matched product and validation state, distinct from the immutable SourceRecord.

**Reason deferred.** Evaluated during the Phase 1.0.2 audit and judged **not required** for durable async imports. The file is already durable in Blob Storage and is already re-parsed from there on confirm, so staging would persist a second copy of data that can be deterministically reconstructed. Its real value is chunk-granular resume without re-parsing, which matters at 50,000 rows rather than 10,000. Chunk-boundary resume via progress_rows gives the same durability for far less surface.

**Current phase:** 1.0.2 (evaluated, deferred) - **Target phase:** TBD - **Priority:** P3

**Dependencies.** None.

**Status:** Backlog

**Triggers.**
- Expensive parsing or extraction, where re-deriving rows on retry is costly rather than cheap
- A review-before-commit workflow
- Material parse or resume cost relative to commit cost
- Substantially larger import sizes than the current 10,000-row limit

**Phase 1.1 note.** PDF Intake is likely to strengthen the case materially. Extracting structured data from a document is expensive and lossy in a way CSV parsing is not, and extracted state plausibly needs durable operator review before commit. Both are staging's core justifications, so this should be re-evaluated when Phase 1.1 is designed rather than treated as settled.

---

## DB-014 - Streaming parse from Blob Storage

**Description.** Stream the source file from Blob Storage through a chunked parser into chunked inserts, rather than materializing buffer, string and parsed rows in memory.

**Reason deferred.** The Phase 1.0.2 audit found no measurement showing memory is currently a problem, and the existing synchronous parsers are correct and load-bearing. Rewriting verified parsing code on suspicion is the wrong trade.

**Current phase:** 1.0.2 (evaluated, deferred) - **Target phase:** TBD - **Priority:** P2

**Dependencies.** Memory instrumentation at 1,000 / 10,000 / 50,000 rows must exist first.

**Status:** Backlog

**Triggers.** Measured memory pressure on the 1.75 GB B1 instance, likely above ~50,000 rows.

---

## DB-015 - External queue (Azure Service Bus) for imports

**Description.** Replace the PostgreSQL-backed job queue with a real broker.

**Reason deferred.** The audit found nothing requiring one. A database queue is transactionally consistent with the data it governs and adds no infrastructure. The lease model (locked_by, lock_expires_at, attempts) is deliberately broker-shaped, so migration would replace only the acquisition query.

**Current phase:** 1.0.2 (evaluated, deferred) - **Target phase:** TBD - **Priority:** P3

**Dependencies.** DB-016 in practice.

**Status:** Backlog

**Triggers.** More than one worker instance; queue depth persistently above ~100 or oldest-queued-age in minutes; another service needing import events; priority or scheduled execution; poll load on Postgres becoming measurable.

---

## DB-016 - Multi-instance import workers

**Description.** Run import workers across more than one App Service instance.

**Reason deferred.** The environment is pinned to a single instance and scale-out is already unsafe while startup migrations are in use. The Phase 1.0.2 lease design is nonetheless correct for multiple workers from day one, because leasing is cheap to build and expensive to retrofit.

**Current phase:** 1.0.2 (design accommodates, not enabled) - **Target phase:** TBD - **Priority:** P3

**Dependencies.** Requires resolving startup-migration-vs-scale-out first.

**Status:** Backlog
