# Async Import Architecture — Phase 1.0.2 Audit & Proposal

> **Status:** Proposal — **awaiting approval. No implementation has begun.**
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
