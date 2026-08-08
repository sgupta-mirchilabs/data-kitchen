# Phase 1.0.2 — Import Scalability & Background Processing

> **Status:** Complete
> **Increment A (durability):** delivered and deployed 2026-08-08 — commits `df12cd6`, `a541091`, `bebd95a`, `488fe2b`
> **Increment B (throughput):** delivered and measured 2026-08-08 — commits `1fa4042`, `5b6c3cd`, `4232ab4`
> **Environment:** Internal Mirchi Labs development (`datakitchen-db-dev`, PostgreSQL 16 Flexible Server, Standard_B1ms)
> **Detail:** [ASYNC_IMPORT_ARCHITECTURE.md](../architecture/ASYNC_IMPORT_ARCHITECTURE.md)

---

## 1. What this phase was for

Two independent problems, deliberately not conflated:

1. **Durability.** Import work was bound to an HTTP request. There was no persisted job state, no recovery, and no terminal failure state — an App Service restart left a batch stuck at `parsing` forever, with rows half-committed and nothing recording that.
2. **Throughput.** The pipeline issued 12–19 serial database round trips per row. Even once asynchronous, a 10,000-row import would have taken roughly 49 minutes.

Fixing durability alone gives imports that survive restarts but still take half an hour. Fixing throughput alone gives faster imports that still die on restart. Both shipped, in that order.

---

## 2. Increment A — durability

The operator confirms and receives `202 Accepted`. The run is a PostgreSQL-backed job with a lease, a heartbeat, bounded retry, a formal state machine with guarded transitions, and a resume pointer that advances only inside the transaction committing the work it counts.

Delivered: 12 additive job columns on `import_batch`, `acquireLease` with `FOR UPDATE SKIP LOCKED`, an in-process single-instance worker, status and cancel endpoints, frontend progress with "you can leave this page", Import History job states, lifecycle-only audit events, and refusal (rather than silent truncation) of files over the row limit.

Proven live before Increment B began: a probe batch pointing at a nonexistent blob was queued directly into the cloud database and, within 19.5 seconds, the deployed worker leased it, retried to the bounded limit, and reached terminal `failed` with the lease released.

---

## 3. Increment B — throughput

### 3.1 One authoritative matcher

"Which existing product does this row describe?" had two implementations — one per-row in the commit pipeline, one batched for the confirm-screen preview — and they had already drifted: the preview compared raw GTIN text against stored GTIN-14, so a 12-digit GTIN previewed as a create and committed as an update.

`resolveImportMatches` is now the single definition; both callers route through it and the old `findDuplicate` was deleted. The rule is unchanged (SKU first, GTIN only as a fallback, catalog-scoped) and is now organization-scoped as well. See ADR-026.

### 3.2 Chunk-granular commit

A chunk is planned entirely in memory — one batched match query, one read of the products it will update — and committed as a single transaction whose last statement advances the resume pointer. Creates, source records, provenance and history are bulk inserts. See ADR-027.

### 3.3 Unchanged rows write nothing

A matched row whose product already holds every value it carries produces no canonical write. See ADR-028.

---

## 4. Before and after

Same harness, same instance, same synthetic all-create fixtures.

| rows | before | after | speed-up |
|---|---|---|---|
| 100 | 29,750 ms | **874 ms** | 34× |
| 500 | 146,279 ms | **2,020 ms** | 72× |
| 1,000 | ~4.9 min *(extrapolated)* | **3,498 ms** | ~84× |
| 2,500 | ~12 min *(extrapolated)* | **9,089 ms** | ~79× |
| 10,000 | ~49 min *(extrapolated)* | **32,742 ms** | ~90× |

| rows | statements before | statements after | per row before | per row after |
|---|---|---|---|---|
| 100 | 1,213 | **19** | 12.1 | **0.19** |
| 500 | 6,020 | **51** | 12.0 | **0.10** |
| 10,000 | — | **813** | — | **0.08** |

| rows | transactions before | transactions after |
|---|---|---|
| 100 | 102 | **3** |
| 500 | 502 | **7** |
| 10,000 | — | **102** |

Rows marked *extrapolated* are the arithmetic recorded before Increment B, repeated for comparison and still not measurements.

**Throughput before was flat** — 3.4 rows/sec at both 100 and 500 rows, which is what "cost scales with rows" looks like. **Throughput after rises with file size** (114 → 306 rows/sec) as fixed cost amortises, then plateaus. That change of shape, not the multiplier, is the result.

---

## 5. Semantic regression results

No regression found. Everything the phase promised to preserve was preserved, and each is held by a test rather than by inspection.

| Preserved | Evidence |
|---|---|
| SKU-first, GTIN-second resolution | 20 matcher unit tests |
| Catalog scoping | Matcher unit tests + live acceptance (25 identical SKUs in a sibling catalog untouched) |
| Organization isolation | Matcher unit tests + live acceptance (25 identical SKUs in a neighbouring tenant untouched) |
| In-file duplicate behaviour | Matcher unit tests, including a GTIN-only row landing on a product an earlier row created |
| Preview agrees with commit | 39 equivalence assertions over 13 fixtures, driving both routes to the matcher |
| Immutable source records, one per row | Integration: 10,000 rows → 10,000 source records, 10,000 distinct row numbers |
| Provenance semantics | Integration: 60,000 entries for 10,000 rows × 6 mapped fields |
| History only for changed fields | Unit + integration: a first import writes none; a renamed re-import writes exactly one entry per product |
| Merge semantics (non-empty overwrites, attributes merge) | Chunk-planning unit tests |
| Durability invariant | Increment A's `import-resume.test.ts` unchanged and green, plus five new integration tests against the real pipeline |
| Chunk size is configuration, not semantics | Integration: identical results at chunk sizes 1, 7 and 1000 |

**Test totals: 257 unit, 60 integration** — up from 177 and 48 — all green against the deployed instance.

One intentional behaviour change, recorded rather than hidden: an unchanged re-import no longer moves `updated_at`, because it no longer writes the product. Documented in the operator guide and in ADR-028.

---

## 6. Durability results

All against the real `executeImport`, not a modelled commit shape.

| Scenario | Result |
|---|---|
| Bulk chunk commit fails | Rolls back entirely; the chunk replays row by row and all 50 rows commit exactly once. The unique index would have rejected the replay had anything leaked |
| Every commit attempt fails | No product, no provenance, no history; only diagnostic error source records; status `failed` |
| One unimportable row (300-character SKU) | Fails alone; the other 29 rows commit |
| Attempt dies mid-file (lease lost) | Stops immediately; `progress_rows` = 100, a chunk boundary, and describes exactly what is durable |
| Expired lease reclaimed by a second worker | Resumes at row 101; 300 distinct rows total, 1,500 provenance, 0 duplicates |
| Duplicate delivery of a completed batch | Writes nothing |
| Re-import of an identical file | 0 created, 100 unchanged, no history, `updated_at` unmoved |

---

## 7. Query-count regression guard

Permanent integration tests at 500 and 1,000 rows assert bounds that per-row matching or per-field inserts could not satisfy — statements per row below 0.5, transactions bounded by chunk count, and per-table ceilings on `canonical_product`, `field_provenance`, `source_record` and `import_batch`. A third test runs the same 1,000-row file at chunk sizes 100 and 500 and asserts the coarser run costs materially fewer statements, which is the direct demonstration that the dependency is on chunks rather than rows.

The bounds are several times the measured values, so they fail on a regression in kind rather than on a change in degree.

---

## 8. 10,000-row operator acceptance

Run through the running API and the real in-process worker, synthetic data only. **25/25 checks passed.**

- Upload parsed 10,000 rows in 689 ms; the preview projected 10,000 creates and ignored the identical SKUs seeded elsewhere.
- Confirm returned `202` in 477 ms.
- The client then went silent for 20 seconds. The import reached row 6,100 unattended.
- Terminal state `completed_with_warnings` after 32,093 ms — 312 rows/sec. (The warning is `GTIN_MISSING` on every row: the fixture maps no GTIN column. Unchanged KI-2 behaviour.)
- Import History showed the status and counts; `/results` reconciled at 10,000 total / 10,000 successful / 0 failed / 10,000 created.
- Stored totals reconciled: 10,000 products, 10,000 source records, 10,000 distinct row numbers, 60,000 provenance rows, 0 history rows.
- No tenant or catalog leakage: 25 decoy products with identical SKUs in a sibling catalog and 25 in a neighbouring organization were untouched, and no history was written outside the target catalog.
- 100 chunks of 100, none needing row-by-row isolation.

Fixtures were removed afterwards and the database verified clean.

---

## 9. Memory

| rows | peak heap MB | peak RSS MB |
|---|---|---|
| 100 | 36 | 109 |
| 500 | 38 | 120 |
| 1,000 | 40 | 129 |
| 2,500 | 59 | 160 |
| 10,000 | 70–89 | 195–264 |

Sub-linear growth, comfortably inside the 1.75 GB B1 instance at the configured 10,000-row ceiling. Memory is still not the constraint, which is the measurement DB-014's deferral was waiting on.

---

## 10. Remaining limitations

**Canonical UPDATE statements still scale with changed products.** An import where every row modifies an existing product issues one UPDATE per product. This is a deliberate correctness choice — the update shape is per-row, so batching means either a synthetic `VALUES` join or overwriting columns the row never mentioned — and it is the one path where work still scales with rows. All benchmarks above are all-create fixtures and therefore do not exercise it; an all-update import of the same size will be slower.

**A whole file is still parsed and normalized in memory.** Bounded by `MAX_IMPORT_ROWS` (10,000), measured at under 90 MB of heap. Raising that limit materially is the trigger to revisit DB-014.

**Chunk transactions hold write locks for roughly 290 ms each**, against a few milliseconds per row under Increment A. Immaterial with one writer; worth re-measuring before enabling several (DB-016).

**One worker, one instance.** Deliberate. The lease protocol is already correct for more.

**The frontend was not re-verified in this increment.** It was verified during Increment A and none of its contracts changed — `202`, the status endpoint's shape, and Import History all behave as before, and the acceptance run exercised each of those endpoints directly.

---

## 11. What remains deferred

Unchanged, with the trigger for each restated in [DEFERRED_BACKLOG.md](../DEFERRED_BACKLOG.md). The post-B measurements strengthen rather than weaken every one.

| Item | Trigger |
|---|---|
| **DB-013** staging layer | Phase 1.1 PDF Intake; or files beyond ~50,000 rows where re-parsing on resume dominates |
| **DB-014** streaming parse | `MAX_IMPORT_ROWS` raised materially above 10,000, or heap approaching the instance limit |
| **DB-015** external queue (Service Bus) | More than one worker instance, cross-process fan-out, or delivery guarantees the database queue cannot express |
| **DB-016** multi-instance workers | App Service scale-out, separately blocked while startup migrations are in use |

---

## 12. Recommendation

**Phase 1.0.2 is complete.** Both objectives are met and demonstrated end to end against the development environment: an import is durable across restarts and resumes from committed work, and 10,000 rows complete in 33 seconds where the pre-work arithmetic said 49 minutes. The regression surface is held by 317 automated tests, and the one intentional behaviour change is documented where an operator will meet it.

Two items are worth carrying forward as known, rather than as blockers:

- The all-update path has not been benchmarked at scale. It is correct and tested, but its throughput is unmeasured, and it is the workload most likely to surprise. Worth a measurement pass before any customer-facing volume commitment.
- Increment B is committed and verified against the deployed database, but the running App Service still serves the previous build. Deploying it is an owner action: the GitHub workflow's deploy step still cannot run (DB-009 — `AZURE_CREDENTIALS` is deliberately absent), so the backend ships via `az webapp deploy` as it has before.

Phase 1.1 (PDF Intake) is the next phase and is unblocked. DB-013 should be re-evaluated as part of its design rather than treated as settled.
