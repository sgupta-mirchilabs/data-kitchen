# Async Import Architecture — Phase 1.0.2 Audit & Proposal

> **Status:** Approved. **Increment A delivered and deployed 2026-08-08** (commit `df12cd6`). **Increment B delivered and measured 2026-08-08** (commits `5b6c3cd`, `4232ab4`) — see [§11](#11-increment-b--as-built).
> **Date:** 2026-08-08
> **Scope:** Make Catalog Intake safe and usable at hundreds → tens of thousands of rows without holding an HTTP request open.
> **Preserves:** canonical model, SKU-first/GTIN-second resolution, catalog scoping, organization isolation, immutable SourceRecord, provenance, history, audit, mapping templates, validation and duplicate warnings, merge semantics, Blob Storage layout.

---

## 1. Current-state audit

Established by reading the code and querying the live database, not from memory.

### 1.1 Where the work happens

| Step | Where | When |
|---|---|---|
| File selection, multipart POST | Browser | — |
| Buffer held whole in memory | Fastify | Request 1 |
| SHA-256 checksum | Fastify | Request 1 |
| **Blob upload** | Fastify → Azure | Request 1, **before ImportBatch exists** |
| `buffer.toString("utf-8")` | Fastify | Request 1 |
| **Full parse** (`csv-parse/sync`, `JSON.parse`) | Fastify | Request 1 |
| **ImportBatch created** (`status: uploaded`) | Fastify | Request 1, **after** parse |
| Template match, duplicate detection, projection | Fastify | Request 1 |
| Preview returned | → Browser | Request 1 ends |
| Mapping review | Browser | Between requests |
| **Re-download from Blob + re-parse** | Fastify | Request 2 |
| Normalize, validate, match, commit | Fastify | Request 2, **synchronous loop** |
| Provenance / history / source records | Fastify | Request 2, inside per-row transaction |
| Batch counters + status | Fastify | Request 2, at the very end |

The file is parsed **twice** — once for preview, once for commit. The commit re-reads from Blob Storage rather than trusting anything client-supplied, which is correct for tenancy but doubles parse cost.

### 1.2 Per-row database work in the commit pipeline

Sequential and awaited, one row at a time:

| Operation | Statements |
|---|---|
| `findDuplicate` — SKU lookup, then GTIN if no SKU hit | 1–2 SELECT |
| `findUnique` existing product (update path only) | 0–1 SELECT |
| `canonicalProduct` update **or** create | 1 |
| `sourceRecord` create | 1 |
| `fieldProvenance` create — **one INSERT per mapped field, in a loop** | ~7 |
| `canonicalProductHistory` create — **one INSERT per changed field, in a loop** | 0–8 |

**≈ 12–19 statements per row.** At 10,000 rows that is roughly **120,000–190,000 round trips**, issued serially.

### 1.3 Transaction boundaries

**One transaction per row** (`prisma.$transaction` inside the loop). Not one transaction for the import.

Consequences:
- Lock pressure is low; no long-running transaction. This is a genuinely good property and should be preserved in shape.
- **Partial completion is the normal failure mode.** Rows before a crash are committed; rows after are not. There is no marker distinguishing "finished" from "died halfway".

### 1.4 Indexing — **not** the bottleneck

Corrected finding. Prisma's `@@index` list omits them because Prisma cannot express partial unique indexes, but the live database has:

```
idx_product_sku_catalog   UNIQUE (catalog_id, sku)  WHERE sku IS NOT NULL
idx_product_gtin_catalog         (catalog_id, gtin) WHERE gtin IS NOT NULL
uq_source_record_batch_row UNIQUE (import_batch_id, row_number)
```

`EXPLAIN` on the exact `findDuplicate` predicate returns an **Index Scan** using `idx_product_sku_catalog`. Matching is correctly indexed; the cost is round-trip *count*, not per-lookup cost.

The unique index on `(catalog_id, sku)` is also a ready-made conflict target for set-based upsert.

### 1.5 Accidental idempotency worth keeping

`uq_source_record_batch_row (import_batch_id, row_number)` means a re-run of an already-processed row attempts a duplicate `sourceRecord` insert **inside the same transaction as the canonical write**. The unique violation rolls the whole transaction back, so the canonical update is undone too.

Re-confirming a partially-processed batch therefore does **not** double-apply already-committed rows — they fail cleanly and the remainder proceeds. This is accidental rather than designed, but it is the cheapest available foundation for making retry idempotent.

### 1.6 Failure behaviour today

| Event | Current outcome |
|---|---|
| Malformed row | Caught per row, recorded in `errors`, loop continues |
| **Browser closes** | Node does **not** abort the handler. Processing continues and the batch is finalized. The operator simply never sees the result. |
| **HTTP timeout (~230 s)** | Response is lost; server-side work continues until it finishes or the process restarts |
| **App Service restart** | Process dies mid-loop. Rows committed so far persist. Status stays `parsing` forever. **No detection, no recovery, no resume.** |
| DB failure mid-import | Current row's transaction rolls back; loop continues; remaining rows may also fail |
| Blob read failure | Throws before the loop; batch left at `parsing` |
| Duplicate worker | Not possible today (no worker), but re-confirm is only blocked when `status === "completed"` — a stuck `parsing` batch **can** be re-confirmed |

**There is no retry counter, no lease, no heartbeat, and no terminal `failed` state written on crash.**

### 1.7 Memory

Resident simultaneously during request 1: multipart buffer + UTF-8 string + fully materialized `parseResult.rows` + `allRows` retained for projection and duplicate detection. Parsers are `csv-parse/sync` and `JSON.parse` — **no streaming anywhere**.

For a 50 MB CSV this plausibly reaches several hundred MB on a **B1 instance with 1.75 GB shared with everything else**. Not measured; flagged as a risk to measure, not a claim.

### 1.8 Limits

`MAX_UPLOAD_SIZE_MB` = 50, `MAX_IMPORT_ROWS` = 10,000 — both already configurable via environment. Rows beyond the cap are silently truncated by the parser (`Math.min(records.length, maxRows)`), which is worth surfacing.

### 1.9 The one performance measurement we have

A **5-row import took 918 ms** (observed in the live import summary). That includes fixed overhead — blob download, parse, batch update — so it is an upper bound per row, not a rate.

Naive extrapolation, **explicitly not a benchmark**:

| Rows | Extrapolated | Against the 230 s HTTP limit |
|---|---|---|
| 100 | ~18 s | OK |
| 1,000 | ~3 min | **Exceeds** |
| 10,000 | ~30 min | **Far exceeds** |

Even if fixed overhead dominates the 918 ms and true marginal cost is much lower, the serial round-trip count makes the 10,000-row case implausible within one request. **Real figures must be measured before and after; nothing here should be quoted as a result.**

### 1.10 Audit conclusion

Two independent problems, and it matters not to conflate them:

1. **Durability** — work is bound to an HTTP request with no persisted job state, no recovery, and no terminal failure state. *This is the phase objective.*
2. **Throughput** — 12–19 serial round trips per row. *This is what makes large imports slow even once they are asynchronous.*

Fixing (1) without (2) yields imports that survive restarts but still take 30 minutes. Fixing (2) without (1) yields faster imports that still die on restart. The proposal addresses both, but they are separable and can ship in that order.

---

## 2. Proposed target architecture

**The smallest thing that delivers durable async imports with a clean path to scale.**

### 2.1 Queue: PostgreSQL, not Service Bus

The audit found nothing requiring an external broker. At internal scale — a handful of operators, imports measured in minutes — a database-backed queue with leasing is production-safe, transactional with the data it governs, and adds zero infrastructure.

**Decision: extend `ImportBatch` with job fields. Do not create a separate `ImportJob` table.**

An import batch *is* the job; a second table would need its own lifecycle, its own tenancy checks, and a join on every status read, for no gain at this scale. If concurrency later demands multiple job types per batch, splitting is a mechanical migration.

**Rejected for now, with the trigger that would change it** — see §7.

### 2.2 Worker: in-process, single instance

App Service B1 is pinned to one instance and scale-out is already unsafe while startup migrations run. A `setInterval` poller inside the Fastify process, started after `listen`, is sufficient and adds no deployment surface.

The lease design must nonetheless be correct for multiple workers from day one, because a deployment overlap or a future scale-out would otherwise corrupt state. Leasing is cheap to build and expensive to retrofit.

### 2.3 State machine

Simplified from the suggested list. Two states are omitted deliberately:

- `awaiting_mapping` — the existing `uploaded` state already means exactly this.
- `ready_for_review` / `committing` — there is no review gate between queue and commit today, and inventing one adds a state with no transition source.

```
                 upload request
                       │
                       ▼
                  ┌──────────┐
                  │ uploaded │◄──── operator reviews mapping
                  └────┬─────┘
                       │ confirm  (202 Accepted)
                       ▼
                  ┌──────────┐  cancel   ┌───────────┐
                  │  queued  ├──────────►│ cancelled │
                  └────┬─────┘           └───────────┘
                       │ worker acquires lease
                       ▼
                  ┌────────────┐  cooperative cancel between chunks
                  │ processing ├──────────────────────┐
                  └────┬───┬───┘                      ▼
        all chunks ok  │   │ chunk error        ┌───────────┐
                       │   │                    │ cancelled │
        ┌──────────────┘   └──────────┐         └───────────┘
        ▼                             ▼
┌───────────┐  warnings>0      ┌──────────┐  attempts < max
│ completed │◄──────┐          │  failed  ├──────────────► back to queued
└───────────┘       │          └──────────┘
              ┌─────┴──────────────────┐
              │ completed_with_warnings│
              └────────────────────────┘

Lease expiry: processing ──► queued  (attempts++, reclaimed by any worker)
```

Every transition writes a timestamp. `failed` retains `error_code`, `error_message`, and the failing chunk. Invalid transitions are rejected by a single guarded helper rather than scattered `update` calls — this is the one place worth being strict, since it is what makes status trustworthy after a restart.

### 2.4 Schema changes — all additive

**`ImportBatch` — new nullable columns, no changes to existing ones:**

| Column | Type | Purpose |
|---|---|---|
| `queued_at`, `started_at`, `completed_at`, `heartbeat_at` | `timestamptz` | Lifecycle + liveness |
| `locked_by` | `varchar(100)` | Worker identity |
| `lock_expires_at` | `timestamptz` | Lease expiry, enables reclaim |
| `attempts`, `max_attempts` | `int` | Bounded retry |
| `progress_rows` | `int` | Operator progress |
| `error_code`, `error_message` | `varchar` / `text` | Diagnostics on failure |
| `cancel_requested_at` | `timestamptz` | Cooperative cancellation |

`status` already exists and gains new permitted values. `total_rows` already exists.

**New index** for lease acquisition — the only new index proposed, and only because the poller runs on an interval:

```sql
CREATE INDEX idx_import_batch_queue
  ON import_batch (status, lock_expires_at)
  WHERE status IN ('queued', 'processing');
```

Partial, so it stays tiny — it indexes only in-flight work, not the full import history.

**No other index is proposed.** §1.4 established that matching is already correctly indexed; adding more without a measured plan would be guessing.

### 2.5 Staging layer — **recommended, not required**

The brief proposes `ImportStagingRecord`. My assessment: **it is not required for durable async imports, and I would not build it in the first increment.**

Reasoning: the file is already durable in Blob Storage and is already re-parsed from there on confirm. Staging would persist a second copy of data we can deterministically reconstruct. Its real value is *resumability at chunk granularity* — restarting mid-import without re-parsing — which matters at 50,000 rows, not at 10,000.

**Recommended instead:** resume at chunk boundaries using `progress_rows` against a deterministic parse. Re-parsing 10,000 rows costs seconds; persisting 10,000 staging rows costs a table, a retention policy, and a tenancy surface.

Staging becomes justified when either (a) parse cost becomes material relative to commit cost, or (b) a genuine review-before-commit gate is introduced. Recorded as a deferred item with those triggers.

### 2.6 Bulk comparison — shared with the preview projection

`projectImportImpact` (built in 1.0.1) already does exactly the required thing: one batched query, SKU-first then GTIN, catalog-scoped. **The commit pipeline should call that same function**, eliminating `findDuplicate`-per-row and structurally preventing preview/commit drift.

Per-chunk instead of per-row:

1. One `SELECT` resolving all keys in the chunk → match map
2. `createMany` for source records
3. `createMany` for provenance rows (replacing the per-field insert loop)
4. `createMany` for history rows
5. Creates batched; updates issued per changed product — genuinely divergent `SET` clauses make a single statement awkward, and updates are the minority case in most imports

Expected: **12–19 statements/row → roughly 5–8 statements per chunk.** Stated as design intent; the actual figure must be measured and asserted in a test.

**Transaction boundary: one transaction per chunk**, not per import and not per row. Preserves the low-lock property of today's design while cutting round trips.

### 2.7 Idempotency and retry

`uq_source_record_batch_row` (§1.5) already prevents double-application. Made deliberate:

- Each chunk is `[startRow, endRow)`, derived from `progress_rows`
- `progress_rows` advances **in the same transaction** as the chunk's writes — so it can never claim progress that was not committed
- On retry, processing resumes from `progress_rows`; the unique constraint remains the backstop
- **No duplicate history or provenance**, because a re-run of a committed chunk cannot commit

The crash-after-commit-before-status-update case is handled by this: the chunk transaction includes the progress update, so there is no window between them.

### 2.8 HTTP behaviour

`POST /imports/:id/confirm` → **202 Accepted** with `importBatchId`, `status`, `catalog`, `organization`, `statusUrl`.

`GET /imports/:id/status` → lightweight: status, progress, totals, timestamps, error.

**Polling, not SSE.** 2–5 s while the tab is visible, stopping when hidden. SSE would add connection lifecycle handling against an App Service instance that recycles, to save a request every few seconds for a handful of operators. Not justified. No WebSockets.

### 2.9 Streaming — **deferred, with a caveat**

True streaming from Blob through a chunked parser into chunked inserts is the right end state, but it is a parser rewrite touching verified code, and the audit produced *no measurement* showing memory is currently a problem.

**Recommended now:** keep the existing parse, add memory instrumentation, and measure at 1,000 / 10,000 / 50,000 rows. Convert to streaming when measurement justifies it — and it very likely will above ~50,000 rows on a 1.75 GB instance.

This is the one place I would resist doing more, because the current parsers are correct and load-bearing.

---

## 3. Classification

### Required now — durable async imports

1. `ImportBatch` job columns + lease/heartbeat (§2.4)
2. Formal state machine with guarded transitions (§2.3)
3. In-process polling worker with lease acquisition and expiry reclaim (§2.2)
4. Chunked processing with per-chunk transactions and `progress_rows` (§2.7)
5. `202 Accepted` + status endpoint (§2.8)
6. Frontend: "Import started, you can leave this page" + progress + Import History states (§9 of brief)
7. Lifecycle audit events — `import.queued`, `import.processing_started`, `import.completed`, `import.failed`, `import.retry_started`, `import.cancelled`. **Per import, never per row.**
8. Tenancy: worker derives organization and catalog **from the persisted batch**, never from client input

### Recommended now — cheap, high value

9. **Commit calls `projectImportImpact`** — kills the N+1 *and* guarantees preview/commit agreement (§2.6)
10. `createMany` for provenance, history, source records
11. Queue index (§2.4)
12. Cancellation: `queued` → immediate; `processing` → cooperative between chunks. **Committed rows are never rolled back**, and the UI must say so
13. Observability keyed by `importBatchId`: chunk duration, rows/sec, DB time, retries, queue depth, oldest queued age
14. Surface silent row truncation at `MAX_IMPORT_ROWS`
15. Query-count regression test asserting statements-per-chunk stays bounded

### Deferred — with explicit triggers

| Item | Trigger |
|---|---|
| `ImportStagingRecord` | Parse cost material vs commit cost, **or** a real review-before-commit gate |
| Streaming parse | Measured memory pressure, likely >50,000 rows |
| Service Bus / external queue | Multiple worker instances, cross-service consumers, or queue depth persistently >100 |
| Multi-instance workers | Requires leaving single-instance App Service; lease design already supports it |
| Parallel chunk processing | Only after serial throughput is measured and found insufficient |

### Unnecessary complexity — explicitly rejected

| Rejected | Why |
|---|---|
| Azure Service Bus, Event Grid, Functions | Nothing in the audit requires them; each adds infrastructure, IaC, auth and failure modes |
| Kubernetes, microservices | Wildly disproportionate |
| Redis | Postgres already provides durable state with transactional consistency; Redis would add a second source of truth |
| WebSockets | Explicitly excluded, and polling is adequate |
| Separate `ImportJob` table | A batch *is* the job at this scale |
| One transaction per import | Long locks, memory pressure, and all-or-nothing failure on 50,000 rows |

---

## 4. Migration risk

**Every change is additive**: new nullable columns on `ImportBatch`, one partial index, no data backfill, no column drops or renames.

**Known Prisma hazard, already encountered in 1.0.1.** `prisma migrate dev` previously proposed `ALTER COLUMN "id" DROP DEFAULT` on all ten existing tables plus two index renames — artifacts of a newer Prisma emitting client-side UUIDs. Applied blindly it would strip `gen_random_uuid()` defaults.

**Mandatory:** hand-review the generated SQL and strip anything not part of this change, exactly as in 1.0.1. Then verify defaults survived:

```sql
SELECT table_name, column_default FROM information_schema.columns
WHERE column_name='id' AND table_schema='public';
```

**Deployment ordering.** `startup.sh` applies migrations before the API binds its port, so the new columns exist before any worker starts. In-flight imports at deploy time: none can exist, because today's imports are request-bound and the container restart ends them. Existing rows get `NULL` job fields and are already terminal (`completed`/`parsing`); a one-line backfill marking historical `parsing` rows as `failed` is worth considering, and I would confirm rather than assume.

---

## 5. Alternatives considered

| Alternative | Assessment |
|---|---|
| **Keep synchronous, raise timeouts** | Cannot exceed App Service's 230 s ceiling; loses work on every restart. Rejected. |
| **Fire-and-forget `setImmediate`, no persistence** | Trivially small, but no restart survival, no status, no retry — fails the phase objective. Rejected. |
| **Azure Container Apps Jobs per import** | Genuinely durable, but reintroduces the container platform rejected on cost/complexity in the infrastructure decision, plus per-import cold start. Rejected now; a reasonable future step. |
| **Service Bus + worker** | The correct end state at scale. Premature: nothing measured requires it, and it adds infrastructure to an environment with one operator. Deferred with a trigger. |
| **Separate `ImportJob` table** | Cleaner if imports ever need several job types. Today it is a join and a second tenancy surface for no benefit. Deferred. |
| **`pg-boss` or similar** | Mature Postgres queue library. Rejected because it brings its own schema and semantics for roughly the amount of code we would write, and this queue must be transactionally consistent with `ImportBatch` specifically. |

---

## 6. Complexity estimate

Relative sizing, not a schedule.

| Work | Size | Risk |
|---|---|---|
| Schema + migration (hand-reviewed) | S | **Medium** — Prisma hazard |
| State machine + guarded transitions | S | Low |
| Lease, heartbeat, reclaim | M | **Medium** — the correctness-critical part |
| Chunked processing + progress in-transaction | M | **Medium** — touches verified commit code |
| Bulk comparison via `projectImportImpact` | M | **Medium** — must preserve exact semantics |
| `createMany` for provenance/history/source | S | Low |
| 202 + status endpoint | S | Low |
| Frontend progress + history states | M | Low |
| Audit + observability | S | Low |
| Cancellation | S | Low |
| Integration tests (incl. lease/restart/idempotency) | **L** | Low but substantial |
| Load harness at 100/1k/10k | M | Low |
| Documentation | M | Low |

**Largest risk is not the queue — it is touching the commit pipeline.** That code is verified end to end and carries the semantics the phase must preserve. Two mitigations I would insist on: land bulk comparison as a *separate, independently reviewable* change from the async machinery, and keep the query-count assertion as a permanent regression test.

### Suggested sequencing

**Increment A — durability only.** Job columns, state machine, lease, worker, 202, status endpoint, frontend progress. Commit pipeline **untouched**; a 10,000-row import still takes ~30 minutes but survives restarts, reports progress, and cannot be lost.

**Increment B — throughput.** Shared bulk comparison, `createMany`, chunk transactions, query-count tests, load measurement.

Splitting this way means the phase objective — durable async imports — is met and verifiable before the higher-risk change to verified commit code begins. Either increment is independently valuable and independently revertible.

---

## 7. When Service Bus becomes justified

Adopt an external broker when **any** holds:

- More than one worker instance is needed (requires leaving single-instance App Service)
- Queue depth is persistently above ~100, or oldest-queued-age regularly exceeds minutes
- Another service must consume import events
- Imports need priority classes or scheduled execution
- Poll frequency against Postgres becomes a measurable load

The lease model above is deliberately broker-shaped: `locked_by` / `lock_expires_at` / `attempts` map directly onto lock tokens, lock renewal, and delivery count. Migration would replace the acquisition query with a broker receive, leaving state machine, chunking and idempotency untouched.

---

## 8. Open questions for approval

1. **Increment A then B, or both together?** I recommend split, for the reason in §6.
2. **Staging layer** — accept my recommendation to defer, or build it now?
3. **Streaming parse** — accept deferral pending measurement?
4. **Historical `parsing` batches** — backfill to `failed`, or leave?
5. **Cancellation scope** — is "queued cancels immediately, processing stops at the next chunk boundary, committed rows are never rolled back" acceptable?


---

## 9. Increment A — as built

Delivered and deployed. The commit pipeline's per-row logic is unchanged; only the surrounding chunk loop is new.

| Item | Status |
|---|---|
| Additive `import_batch` job columns + partial queue index | ✅ 12/12 columns live, index present |
| State machine with guarded transitions | ✅ 11 unit tests |
| Lease / heartbeat / reclaim | ✅ 18 DB-backed tests |
| Single-instance in-process worker | ✅ verified leasing in the cloud |
| 202 Accepted confirm flow | ✅ |
| Status endpoint + cancel endpoint | ✅ |
| Frontend progress, "you can leave this page", cancel | ✅ |
| Import History job states | ✅ |
| Lifecycle audit events (never per row) | ✅ |
| Cancellation semantics | ✅ approved model implemented |
| Observability | ✅ blob/parse/chunk timings, heap, attempts, queue depth |
| Row-limit truncation fixed | ✅ refuses with `IMPORT_ROW_LIMIT_EXCEEDED` |
| Legacy backfill | ✅ no-op (no interrupted rows existed) |

**Live worker proof.** A probe batch pointing at a nonexistent blob was queued directly into the cloud database. Within 19.5 s the deployed worker leased it, retried to the bounded limit, and reached terminal `failed` with `errorCode: PROCESSING_FAILED` and the lease released — demonstrating polling, lease acquisition, bounded retry, diagnostics and terminal-state correctness against the real environment rather than a stub.

### Deviations from the proposal

**Progress granularity.** The proposal said progress advances "in the same transaction as the chunk writes". The commit pipeline uses one transaction *per row*, and changing that would be the rewrite Increment A excludes. Progress is therefore stamped inside the transaction of the row that *closes* each chunk. The invariant the requirement exists to protect — progress can never exceed committed work — holds exactly, and a rollback test asserts it.

**`catalog:read` reused for status.** No `import:read` permission exists, and adding one would change the authorization model, which this phase does not touch.

### Not yet proven

Everything above is verified by test or by the live probe. What has **not** been observed is a real operator import running end to end through the queue — that is the acceptance run.


---

## 10. Increment B — measured pre-optimization baseline

Captured 2026-08-08 by `server/test/bench/import-bench.ts` against the deployed
Azure PostgreSQL instance, driving the **real** commit pipeline and counting
every statement Prisma issues. Runs against a dedicated `[BENCH]` organization
and catalog, created and torn down by the harness, so operator data is never
touched.

### Measured

| rows | total ms | rows/sec | statements | stmt/row | transactions | peak heap MB | peak RSS MB |
|---|---|---|---|---|---|---|---|
| 100 | 29,750 | 3.4 | 1,213 | 12.1 | 102 | 37 | 127 |
| 500 | 146,279 | 3.4 | 6,020 | 12.0 | 502 | 53 | 169 |

### Statements by table (500-row run)

| table | statements | per row | why |
|---|---|---|---|
| `field_provenance` | 3,000 | 6.0 | one INSERT per mapped field, in a loop |
| `canonical_product` | 1,000 | 2.0 | `findDuplicate` SELECT + the create/update |
| `import_batch` | 507 | ~1.0 | the per-row resume-pointer advance (Increment A) |
| `source_record` | 500 | 1.0 | one INSERT per row |
| other | 9 | — | batch setup and teardown |

### What this establishes

- **12 statements per row, flat across sizes** — the audit predicted 12–19, and
  the measurement lands at the bottom of that range because these fixtures have
  no history rows (all creates, no updates).
- **Throughput is 3.4 rows/sec at both 100 and 500 rows.** Perfectly linear:
  5× the rows costs 4.9× the time. This is the N+1 signature, and it means size
  alone will never improve the rate.
- **Roughly one transaction per row** (102 and 502), as designed in Phase 1.
- **Memory is not currently a constraint** — 53 MB heap / 169 MB RSS at 500
  rows, comfortably inside the 1.75 GB B1 instance. This supports keeping
  streaming deferred (DB-014) until measurement says otherwise.

### Extrapolations — **not measurements**

At the measured 3.4 rows/sec, and labelled explicitly as arithmetic rather than
observed results:

| rows | extrapolated duration |
|---|---|
| 1,000 | ~4.9 minutes |
| 2,500 | ~12 minutes |
| 10,000 | **~49 minutes** |

The 1,000 and 2,500 runs were not executed: at this throughput they cost ~5 and
~12 minutes of wall clock each, and the 100→500 pair already demonstrates
linearity conclusively. They should be run as part of the post-B comparison,
where the whole point is that they will no longer be linear.

### Separate datapoint — 250-row crash/resume

The Increment A durability test (`import-resume.test.ts`) commits 321
row-transactions in **42 seconds**, ≈130 ms per row-transaction against the same
remote instance. Recorded separately because it exercises the transaction shape
rather than the full pipeline.

---

## 11. Increment B — as built

Delivered 2026-08-08. Objective: eliminate the serial per-row database round trip
without changing what an import means.

### 11.1 What changed

**One authoritative matcher.** "Which existing product does this row describe?"
was answered in two places — `findDuplicate`, one query per row, in the commit
pipeline; and `projectImportImpact`, one batched query, for the confirm screen.
Two implementations of one rule had already drifted: the preview compared raw
GTIN text against stored GTIN-14, so a 12-digit GTIN previewed as a create and
committed as an update. `resolveImportMatches` is now the single definition and
both callers route through it. `findDuplicate` was deleted rather than left as a
second, dead definition.

The rule is unchanged — SKU first, GTIN only as a fallback, catalog-scoped — and
is now organization-scoped as well, since both callers already know the
organization.

In-file duplicate behaviour was previously *emergent*: a product created by row 3
was in the database by the time row 40 was matched, so row 40 updated it.
A batched resolver has to reproduce that deliberately, so rows are registered in
the index as they resolve, and a stable `createIndex` lets several rows agree on
one product before any id exists.

**Chunk-granular commit.** A chunk is planned entirely in memory — one batched
match query and one read of the products it will update — and committed as a
single transaction whose last statement advances the resume pointer. Creates,
source records, provenance and history are bulk inserts, split at 500 records to
stay inside PostgreSQL's bind-parameter limit. `IMPORT_CHUNK_SIZE` was already
the checkpoint interval; it is now the transaction boundary as well.

**Unchanged rows cost nothing.** A matched row whose product already holds every
value it carries produces no canonical write at all. Before, such a row rewrote
`data_quality_status` and `updated_by` unconditionally.

### 11.2 What deliberately did not change

**Canonical UPDATEs are still one statement per changed product.** The update
shape is per-row — which columns appear depends on which fields the row carried
— so batching them means either a synthetic `VALUES` join or overwriting columns
the row never mentioned. Correctness first. The saving that matters is that
products which do not change are not written at all.

**Row-level fault isolation.** Increment A gave every row its own transaction, so
one unimportable row cost one row. Under chunking a naive implementation would
cost the whole chunk. A chunk whose bulk commit fails is therefore replayed one
row at a time. The replay is also the proof that the failed bulk attempt left
nothing behind — `uq_source_record_batch_row` would reject it otherwise.

**The durability invariant.** `progress_rows` still means the highest FULLY
committed source row, because it still commits with the work it counts. What
changed is only the size of the unit: a chunk that fails rolls back its writes
and its progress together.

### 11.3 Measured — before and after

Same harness (`server/test/bench/import-bench.ts`), same Azure PostgreSQL
instance (`datakitchen-db-dev`, Standard_B1ms), same synthetic all-create
fixtures, same statement counting from Prisma's query event stream.

| rows | before ms | after ms | speed-up | before rows/s | after rows/s |
|---|---|---|---|---|---|
| 100 | 29,750 | **874** | 34x | 3.4 | **114.4** |
| 500 | 146,279 | **2,020** | 72x | 3.4 | **247.5** |
| 1,000 | *~4.9 min (extrapolated)* | **3,498** | ~84x | — | **285.9** |
| 2,500 | *~12 min (extrapolated)* | **9,089** | ~79x | — | **275.1** |
| 10,000 | *~49 min (extrapolated)* | **32,742** | ~90x | — | **305.4** |

| rows | before statements | after statements | before /row | after /row | before txns | after txns |
|---|---|---|---|---|---|---|
| 100 | 1,213 | **19** | 12.1 | **0.19** | 102 | **3** |
| 500 | 6,020 | **51** | 12.0 | **0.10** | 502 | **7** |
| 1,000 | — | **91** | — | **0.09** | — | **12** |
| 2,500 | — | **212** | — | **0.08** | — | **27** |
| 10,000 | — | **813** | — | **0.08** | — | **102** |

The rows marked *extrapolated* are the arithmetic recorded in section 10 before
Increment B, repeated here for comparison and still not measurements.

**The shape of the curve is the finding.** Before, throughput was 3.4 rows/sec at
both 100 and 500 rows — flat, which is what "cost scales with rows" looks like.
After, throughput *rises* with file size (114 to 306 rows/sec) as fixed per-run
cost is amortised, then plateaus. Statements per row falls from 12.1 to 0.08 and
keeps falling as files grow.

### 11.4 Where the time goes now (10,000 rows)

| phase | ms | share |
|---|---|---|
| blob download | 3 | <1% |
| parse | 41 | <1% |
| batched matching (100 queries) | 2,662 | 8% |
| read products to update | 0 | 0% (all creates) |
| in-memory planning | 23 | <1% |
| canonical writes | 5,129 | 16% |
| source records | 4,402 | 13% |
| provenance | 11,871 | 36% |
| history | 0 | 0% (all creates) |
| resume pointer | 2,438 | 7% |
| **total inside chunk transactions** | **28,912** | **88%** |

Parsing is now 0.1% of the run, which is direct evidence that streaming (DB-014)
remains correctly deferred. The dominant cost is provenance — six rows per source
row, 60,000 inserts — and it is already bulk; what remains is the volume of data
itself, not round trips.

### 11.5 Statements by table (10,000 rows)

| table | statements | per row | what it is |
|---|---|---|---|
| `canonical_product` | 200 | 0.02 | 1 match query + 1 bulk create per chunk |
| `field_provenance` | 200 | 0.02 | 2 bulk inserts per chunk (600 rows, split at 500) |
| `import_batch` | 107 | 0.01 | resume pointer per chunk, heartbeats, terminal transition |
| `source_record` | 100 | 0.01 | 1 bulk insert per chunk |

Compare the 500-row pre-B profile in section 10: `field_provenance` alone was
6.0 statements per row.

### 11.6 Memory

| rows | peak heap MB | peak RSS MB |
|---|---|---|
| 100 | 36 | 109 |
| 500 | 38 | 120 |
| 1,000 | 40 | 129 |
| 2,500 | 59 | 160 |
| 10,000 | 70–89 | 195–264 |

Growth is sub-linear and the 10,000-row peak sits well inside the 1.75 GB B1
instance. The whole file is still parsed into memory and every row is normalized
up front; at 10,000 rows — the configured `MAX_IMPORT_ROWS` — that costs under
90 MB of heap. Memory is still not the constraint.

### 11.7 Verification

| Concern | How it is held |
|---|---|
| Preview and commit classify identically | 39 unit equivalence assertions over 13 fixtures, driving both routes to the matcher |
| Matching rule, including in-file duplicates | 20 unit tests on the matcher |
| Chunk planning semantics | 28 unit tests — creates, updates, unchanged, history chaining, provenance linkage, insert slicing |
| Chunk rollback | Integration: a failed bulk commit replays row-by-row, and the unique index proves nothing leaked |
| Total commit failure | Integration: no product, provenance or history written; only diagnostic error records |
| Row-level fault isolation | Integration: a 300-character SKU fails alone; the other 29 rows commit |
| Attempt dies mid-file | Integration: lease loss aborts after chunk 1; progress names a chunk boundary and describes exactly what is durable |
| Reclaim and resume | Integration: expired lease, second worker, resumes at row 101, 300 distinct rows total |
| Retry writes nothing twice | Integration: re-lease after completion writes nothing; re-import of an identical file changes no product and no `updated_at` |
| Chunk size is configuration, not semantics | Integration: identical results at chunk sizes 1, 7 and 1000 |
| Query counts scale by chunk | Integration at 500 and 1,000 rows, plus a same-file 10-chunk vs 2-chunk comparison |

Totals: **257 unit tests, 60 integration tests**, all green against the deployed
instance.

### 11.8 Operator acceptance — 10,000 rows

Run 2026-08-08 through the running API and the real in-process worker
(`server/test/acceptance/ten-thousand-row-import.ts`), synthetic data only,
against `datakitchen-db-dev`. **25/25 checks passed.**

| Check | Result |
|---|---|
| Upload parses 10,000 rows | 689 ms |
| Preview projects 10,000 creates, ignoring identical SKUs elsewhere | pass |
| Confirm returns 202 | 477 ms |
| Operator closes the browser (20 s, no client contact) | import reached row 6,100 unattended |
| Progress advances while polling | 6 distinct values across 7 polls |
| Terminal state | `completed_with_warnings` in 32,093 ms — 312 rows/sec |
| Import History shows the status and counts | pass |
| Results reconcile | 10,000 total / 10,000 successful / 0 failed / 10,000 created |
| Stored totals reconcile | 10,000 products, 10,000 source records, 10,000 distinct row numbers, 60,000 provenance, 0 history |
| Tenant isolation | 25 identical SKUs in a neighbouring organization untouched |
| Catalog isolation | 25 identical SKUs in a sibling catalog of the same organization untouched |
| Memory | 89 MB heap / 264 MB RSS |
| Chunking | 100 chunks of 100, 0 needing row-by-row isolation |

The `completed_with_warnings` status is correct and expected: the fixture maps no
GTIN column, so every row raises `GTIN_MISSING` (KI-2). That is unchanged
behaviour, not a regression.

### 11.9 Deviations and known limitations

**`updated_at` no longer moves on an unchanged re-import.** This is the visible
consequence of skipping the write, and it is intentional: re-importing an
unchanged file is now free rather than rewriting every product in the catalog.
Source records and provenance are still written, so the import remains evidence
the row was seen, and `/imports/:id/results` still counts such rows as updates.

**Canonical UPDATE statements still scale with changed products.** An import
where every row modifies an existing product will issue one UPDATE per product.
That is a deliberate correctness choice (11.2), and it is the one path where work
still scales with rows rather than chunks.

**A whole file is still parsed and normalized in memory.** Bounded by
`MAX_IMPORT_ROWS` (10,000) and measured at under 90 MB of heap. Raising that
limit materially is the trigger to revisit DB-014.

**Chunk transactions hold locks for their duration** — roughly 290 ms per
100-row chunk at 10,000 rows. Acceptable on a single-writer instance; it is a
factor to re-measure if multiple workers are ever enabled (DB-016).

### 11.10 What remains deferred, and the trigger for each

Unchanged by Increment B. The measurements above strengthen rather than weaken
each deferral.

| Item | Trigger to revisit |
|---|---|
| **DB-013** staging layer | Phase 1.1 PDF Intake, where extraction is expensive and lossy and plausibly needs durable review before commit; or files beyond ~50,000 rows where re-parsing on resume becomes the dominant cost |
| **DB-014** streaming parse | `MAX_IMPORT_ROWS` raised materially above 10,000, or measured heap approaching the instance limit. Parsing is currently 0.1% of a 10,000-row run |
| **DB-015** external queue (Service Bus) | More than one worker instance, cross-process fan-out, or a need for delivery guarantees the database queue cannot express |
| **DB-016** multi-instance workers | Scale-out of App Service, which is separately blocked while startup migrations are in use. The lease protocol is already correct for it |
