# Data Kitchen — Project Roadmap

> **Master roadmap.** Phase status at a glance, with links to the detail.
>
> Companion to [DEFERRED_BACKLOG.md](./DEFERRED_BACKLOG.md), which holds everything intentionally postponed.
> Phase rationale and capability detail live in [architecture/ROADMAP.md](./architecture/ROADMAP.md).

**Last updated:** 2026-08-08

---

## Phases

| Phase | Name | Status |
|---|---|---|
| **Phase 0** | Prototype | ✅ Complete |
| **Phase 1** | Catalog Intake | ✅ Complete |
| **Phase 1.0.1** | Cleanup Sprint | ✅ Complete |
| **Phase 1.0.2** | Import Scalability & Background Processing | ✅ Complete — durable async imports, 10,000 rows in 33 s |
| **Phase 1.1** | PDF Intake | ⬜ Next |
| **Phase 2** | Retail Intelligence Library | ⬜ Planned |
| **Phase 3** | Mapping Engine | ⬜ Planned |
| **Phase 4** | Validation Engine | ⬜ Planned |
| **Phase 5** | Delivery Engine | ⬜ Planned |
| **Phase 6** | Retail Feedback | ⬜ Planned |

---

## Phase 1 — Catalog Intake ✅

CSV and JSON import into a canonical product model, with original source records preserved, field-level provenance, product history, import history, and audit logging — multi-tenant, Entra-authenticated, deployed to Azure.

**Verified end to end** in the internal environment on 2026-08-07: 8 imports, 28/28 rows, 0 failures, 0 referential tenant-integrity mismatches across 251 linked rows.

📄 [V1_FOUNDATION_COMPLETION.md](./releases/V1_FOUNDATION_COMPLETION.md)

---

## Phase 1.0.1 — Cleanup Sprint ✅

Polish and correctness for internal operators. No new platform capability.

- Saved mapping templates — a recurring export is recognised and never re-mapped
- Lightweight identifier validation (resolved KI-2)
- Duplicate-SKU warning at preview (resolved KI-3)
- Explicit catalog selection (resolved KI-1)
- Detailed import summary
- Prototype/demo artifacts removed from the live workspace
- Internal operator guide

📄 [PHASE_1_0_1_CLEANUP.md](./releases/PHASE_1_0_1_CLEANUP.md) · 📄 [Operator guide](./user-guides/CATALOG_INTAKE_OPERATOR_GUIDE.md)

**Deferred out of this phase:** DB-001, DB-002, DB-003.

---

## Phase 1.0.2 — Import Scalability & Background Processing ✅

Durable asynchronous imports: the operator confirms, receives a 202, and may close the browser. Processing continues in a PostgreSQL-backed job with leasing, restart recovery, chunked transactions and visible progress.

**Audit finding:** the pipeline issued **12-19 serial database round trips per row** and ran inside the HTTP request with no persisted job state, so a restart lost the run with no recovery and no terminal failure state. Matching itself was correctly indexed; round-trip count was the cost.

**Delivered.** Increment A made imports durable. Increment B removed the per-row round trip: a chunk is planned in memory and committed as one transaction, and matching is a single batched query shared with the confirm-screen preview.

| | before | after |
|---|---|---|
| 500 rows | 146 s | **2.0 s** |
| 10,000 rows | ~49 min (extrapolated) | **33 s** |
| statements per row | 12.0 | **0.08** |

Accepted end to end against the development environment: 10,000 synthetic rows through the real API and worker, browser closed mid-run, 25/25 checks including tenant and catalog isolation.

[ASYNC_IMPORT_ARCHITECTURE.md](./architecture/ASYNC_IMPORT_ARCHITECTURE.md) · 📄 [PHASE_1_0_2_COMPLETION.md](./releases/PHASE_1_0_2_COMPLETION.md)

**Deferred out of this phase:** DB-013 (staging), DB-014 (streaming), DB-015 (Service Bus), DB-016 (multi-instance workers).

---

## Phase 1.1 — PDF Intake ⬜ Next

Accept PDF product documents as an import source, extracting structured data into the same canonical pipeline.

**Key design question:** provenance must represent lower-confidence extracted values distinctly from parsed CSV/JSON values — an extracted field is an inference, not a transcription.

📌 DB-004

---

## Phase 2 — Retail Intelligence Library ⬜

Retailer profiles, attribute libraries, validation rule sets, reference data, and readiness scoring. The knowledge layer that makes Data Kitchen a retail intelligence platform rather than a generic transformation tool.

📌 DB-005

---

## Phase 3 — Mapping Engine ⬜

Persistent, versioned, retailer-specific mapping rules with transformations — templates, inheritance, preview, coverage reporting.

Phase 1.0.1's saved templates are **column mappings only**; transformation logic belongs here.

📌 DB-007

---

## Phase 4 — Validation Engine ⬜

Configurable, retailer-aware validation with severity levels and remediation guidance.

Phase 1.0.1 validates **product identifiers only**.

📌 DB-006

---

## Phase 5 — Delivery Engine ⬜

Generate and deliver retailer-ready output, with submission tracking.

---

## Phase 6 — Retail Feedback ⬜

Ingest retailer rejections and feedback, route them to root cause, and close the loop back into mapping and validation.

---

## Working agreements

1. **Deferred work goes in [DEFERRED_BACKLOG.md](./DEFERRED_BACKLOG.md)**, not in conversation history. Record it when the decision is made, with the reason.
2. **A phase is complete when it is verified in the deployed environment**, not when the code merges.
3. **Known issues are tracked in the phase's release document** and carried forward until resolved.
4. **Architecture is not redesigned mid-phase.** Structural change is its own phase.

---

## Document map

| Document | Purpose |
|---|---|
| [PROJECT_ROADMAP.md](./PROJECT_ROADMAP.md) | This file — phase status at a glance |
| [DEFERRED_BACKLOG.md](./DEFERRED_BACKLOG.md) | Everything intentionally postponed |
| [architecture/ROADMAP.md](./architecture/ROADMAP.md) | Phase rationale and capability detail |
| [releases/V1_FOUNDATION_COMPLETION.md](./releases/V1_FOUNDATION_COMPLETION.md) | Phase 1 completion and verification |
| [releases/PHASE_1_0_1_CLEANUP.md](./releases/PHASE_1_0_1_CLEANUP.md) | Phase 1.0.1 release notes |
| [user-guides/CATALOG_INTAKE_OPERATOR_GUIDE.md](./user-guides/CATALOG_INTAKE_OPERATOR_GUIDE.md) | Operator guide |
| [deployment/AZURE_INFRASTRUCTURE.md](./deployment/AZURE_INFRASTRUCTURE.md) | Infrastructure plan |
| [deployment/DEPLOYMENT_STATUS.md](./deployment/DEPLOYMENT_STATUS.md) | Environment checkpoint |
| [architecture/MULTI_TENANCY.md](./architecture/MULTI_TENANCY.md) | Tenancy model |
| [../PROJECT_STATE.md](../PROJECT_STATE.md) | **The canonical engineering checkpoint** — what exists, what is deployed, what is measured |
| [architecture/ASYNC_IMPORT_ARCHITECTURE.md](./architecture/ASYNC_IMPORT_ARCHITECTURE.md) | Phase 1.0.2 audit, async import proposal, and both increments as built |
| [releases/PHASE_1_0_2_COMPLETION.md](./releases/PHASE_1_0_2_COMPLETION.md) | Phase 1.0.2 completion report — before/after measurements and acceptance |
