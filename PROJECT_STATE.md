# Data Kitchen — Project State

> **The canonical engineering checkpoint.** What exists, what is deployed, what is measured, and what is known to be missing — as of the last update below.
>
> **Last updated:** 2026-08-08 · **Tag:** `v1.0.2` · **Branch:** `main`
> **Scope:** engineering reality. Phase intent lives in [PROJECT_ROADMAP.md](./docs/PROJECT_ROADMAP.md); deferred work lives in [DEFERRED_BACKLOG.md](./docs/DEFERRED_BACKLOG.md); reasoning lives in [ARCHITECTURE_DECISIONS.md](./docs/architecture/ARCHITECTURE_DECISIONS.md).

**Keeping this current:** update it when a phase closes, when something is deployed, or when a measurement changes. It should never describe intent — only what is true.

---

## 1. Phase status

| Phase | What it is | Status |
|---|---|---|
| 1 | Catalog Intake, canonical model, persistence, multi-tenancy, auth | ✅ Complete |
| 1.0.1 | Cleanup — mapping templates, duplicate/overwrite warnings, identifier validation | ✅ Complete |
| **1.0.2** | **Import scalability & background processing** | ✅ **Complete, deployed, accepted** |
| 1.1 | PDF Intake | ⬜ Next — **not started** |
| 2–7 | Retail Intelligence, Mapping, Validation, Delivery, Feedback, AI | ⬜ Planned |

Phase 1.0.2 completion report: [PHASE_1_0_2_COMPLETION.md](./docs/releases/PHASE_1_0_2_COMPLETION.md).

---

## 2. What is deployed

| | |
|---|---|
| **Backend** | `datakitchen-api-dev` — Azure App Service, Linux, Node 22 LTS, B1 |
| **Deployment** | `740ad32b`, 2026-08-08 — built from tree `b08a6bd` |
| **Database** | `datakitchen-db-dev` — PostgreSQL 16 Flexible Server, Standard_B1ms, 7 migrations applied |
| **Storage** | Azure Blob, tenant-prefixed |
| **Frontend** | Azure Static Web Apps (Free) — **unchanged since Phase 1.0.1** |
| **Auth** | `AUTH_MODE=entra` in the cloud; `development` (static `DEV_AUTH_TOKEN`) locally |

Verified after the last deploy: health `200` with `database: connected`; unauthenticated requests rejected `401`; deployed `dist/services` listing matches the tagged build.

**Deployment is manual.** The GitHub workflow's test job runs on push to `main`; its deploy job fails at `azure/login` because `AZURE_CREDENTIALS` is deliberately absent (DB-009 — creating a service principal is an owner decision). The backend ships by bearer-token zipdeploy following the packaging constraints in [AZURE_INFRASTRUCTURE.md](./docs/deployment/AZURE_INFRASTRUCTURE.md) §"Deployment packaging notes".

**Active environment blocker:** interactive sign-in fails with `AADSTS50020` — an Entra identity/tenant-membership problem, not application code. See [DEPLOYMENT_STATUS.md](./docs/deployment/DEPLOYMENT_STATUS.md). Nothing in Phase 1.0.2 depends on it; the acceptance run used the development auth mode against the deployed database.

---

## 3. Shape of the system

React + Vite SPA → Fastify 5 (Node 22, TypeScript 5.7) → Prisma 6 → PostgreSQL 16, with Azure Blob for uploaded files. Single process, single instance; the import worker runs in-process.

**11 Prisma models:** Organization, User, OrganizationMembership, AuditLog, Catalog, ImportBatch, CanonicalProduct, SourceRecord, CanonicalProductHistory, FieldProvenance, MappingTemplate.

**22 HTTP routes** across health, user, catalog, import, product and organization.

The import path, which is where nearly all Phase 1.0.2 work landed:

| Module | Responsibility |
|---|---|
| `services/import.service.ts` | Orchestration: parse, chunk loop, heartbeat, cancellation, terminal transition |
| `services/import-chunk.ts` | Chunk planning — pure, no database access |
| `services/import-matching.ts` | **Authoritative** SKU/GTIN matching, batched, shared with the preview |
| `services/import-projection.ts` | Confirm-screen impact projection, via the same matcher |
| `jobs/import-job.repository.ts` | Lease, heartbeat, reclaim, guarded state transitions, progress |
| `jobs/import-worker.ts` | In-process poller; bounded retry; lifecycle audit |

`ImportBatch` doubles as the job record. Job columns are kept logically distinct from business metadata so extracting a dedicated table later stays mechanical.

---

## 4. Measured performance

All figures from `server/test/bench/import-bench.ts` against `datakitchen-db-dev`, `IMPORT_CHUNK_SIZE=100`, synthetic fixtures, run from a host **remote** from the database. Production numbers should be better: App Service and PostgreSQL share a region.

### Throughput by workload

| rows | workload | duration | rows/sec | statements | /row | txns | canonical UPDATEs | heap MB | RSS MB |
|---|---|---|---|---|---|---|---|---|---|
| 100 | create | 874 ms | 114.4 | 19 | 0.19 | 3 | 0 | 36 | 109 |
| 500 | create | 2,020 ms | 247.5 | 51 | 0.10 | 7 | 0 | 38 | 120 |
| 1,000 | create | 3,992 ms | 250.5 | 93 | 0.09 | 12 | 0 | 39 | 126 |
| 2,500 | create | 9,089 ms | 275.1 | 212 | 0.08 | 27 | 0 | 59 | 160 |
| 5,000 | create | 17,473 ms | 286.2 | 416 | 0.08 | 52 | 0 | 62 | 165 |
| 10,000 | create | 32,742 ms | 305.4 | 813 | 0.08 | 102 | 0 | 89 | 264 |
| 1,000 | **update** | 28,461 ms | **35.1** | 1,105 | 1.11 | 12 | 1,000 | 55 | 145 |
| 5,000 | **update** | 144,306 ms | **34.6** | 5,473 | 1.09 | 52 | 5,000 | 65 | 214 |
| 10,000 | **mixed** 10/30/60 | 115,356 ms | **86.7** | 4,019 | 0.40 | 102 | 3,000 | 106 | 337 |

Pre-Increment-B, for reference: 100 rows took 29,750 ms and 500 rows took 146,279 ms — 3.4 rows/sec at both, 12 statements per row.

### Rows written (10,000-row runs)

| workload | source records | provenance | history | created | updated | unchanged |
|---|---|---|---|---|---|---|
| create | 10,000 | 60,000 | 0 | 10,000 | 0 | 0 |
| mixed | 10,000 | 60,000 | 12,000 | 1,000 | 9,000 | 6,000 |

`updated` counts every matched row; `unchanged` is the subset that needed no write at all.

### What the numbers say

- **Creates scale by chunk.** Statements per row falls to 0.08 and throughput *rises* with file size as fixed cost amortises.
- **Updates scale by row**, at ~35 rows/sec flat across 1,000 and 5,000. One `UPDATE` per changed product, ≈24 ms each — a network round trip, not query cost. The canonical write phase is 88% of commit time in those runs. This is the deliberate residue of ADR-027 and is tracked as **DB-017** with triggers.
- **The unchanged-row skip earns its keep.** The mixed run matched 9,000 rows but issued 3,000 UPDATEs; without ADR-028 it would have issued 9,000 and cost roughly 145 s more.
- **Memory is not a constraint.** 106 MB heap / 337 MB RSS at the worst measured point, against 1.75 GB. Parsing is ~0.1% of a 10,000-row create run.

### Operator acceptance

10,000 synthetic rows through the live API and worker: confirm `202` in 477 ms, client silent for 20 s (import reached row 6,100 unattended), terminal in 32.1 s at 312 rows/sec, 25/25 checks including tenant and catalog isolation against decoy products with identical SKUs.

---

## 5. Tests

| Suite | Count | Needs a database |
|---|---|---|
| Unit (`server/test/unit`) | 257 | No |
| Integration (`server/test/integration`) | 60 | Yes |
| Benchmark (`server/test/bench`) | — | Yes |
| Acceptance (`server/test/acceptance`) | 25 checks | Yes, plus a running API |

```bash
cd server && npm test
```

```bash
cd server && npm run test:integration
```

```bash
cd server && BENCH_SPEC=1000:create,1000:update,10000:mixed npx tsx test/bench/import-bench.ts
```

```bash
cd server && npx tsx test/acceptance/ten-thousand-row-import.ts
```

`DATABASE_URL` must point at a reachable PostgreSQL for everything but the unit suite. The acceptance script additionally needs the API listening on `API_BASE` (default `http://127.0.0.1:3001/api/v1`).

**Test-isolation note.** `acquireLease` deliberately arbitrates over one global queue with no tenant filter, so a fixture batch left at `queued` is claimable by any suite running in parallel. Suites that drive `executeImport` directly set `max_attempts = 0` before enqueueing to stay out of it; `import-resume.test.ts` uses far-future leases for the same reason. Keep this in mind when adding integration tests that create batches.

---

## 6. Known limitations

| Limitation | Detail |
|---|---|
| **Update-heavy imports are ~8× slower than creates** | Measured, understood, tracked as DB-017 with triggers. Not a defect |
| Files are parsed whole into memory | Bounded by `MAX_IMPORT_ROWS` (10,000); measured at <90 MB heap. DB-014 |
| One worker, one instance | Deliberate. The lease protocol is already correct for more. DB-015, DB-016 |
| Chunk transactions hold write locks ~290 ms | Immaterial with a single writer; re-measure before enabling several |
| No product edit or delete in the UI | An import overwrite cannot be undone through the product screen. DB-012 |
| Blank values never clear a field | An omitted or blank incoming value leaves the existing value. DB-008 |
| Interactive sign-in blocked | `AADSTS50020`, an Entra tenancy issue. DB-010 |
| Backend CI deploy step fails | `AZURE_CREDENTIALS` absent by choice. DB-009 |
| Mapping templates have no management UI | A saved template silently shapes every matching future import. DB-001 |
| Repository `README.md` is still the Vite starter template | Cosmetic, but it is the first thing a new engineer reads |

---

## 7. Deferred work

17 items, all with reasons and triggers, in [DEFERRED_BACKLOG.md](./docs/DEFERRED_BACKLOG.md). The ones bearing on the import pipeline:

| ID | Item | Trigger to revisit |
|---|---|---|
| DB-013 | Import staging layer | Phase 1.1 PDF Intake, or files beyond ~50,000 rows |
| DB-014 | Streaming parse | `MAX_IMPORT_ROWS` materially above 10,000, or heap pressure |
| DB-015 | External queue (Service Bus) | More than one worker instance, or cross-process fan-out |
| DB-016 | Multi-instance workers | App Service scale-out (blocked by startup migrations) |
| DB-017 | Set-based canonical UPDATE | >5,000 changed products in a real import, or `timings.canonicalMs` > 120,000 ms |

`DB-011` (asynchronous imports) is **Done** — delivered by Phase 1.0.2.

---

## 8. Where to find things

| Question | Document |
|---|---|
| What is the product and why | [ARCHITECTURE_DECISIONS.md](./docs/architecture/ARCHITECTURE_DECISIONS.md) |
| What ships in which phase | [PROJECT_ROADMAP.md](./docs/PROJECT_ROADMAP.md), [ROADMAP.md](./docs/architecture/ROADMAP.md) |
| How the system is put together | [SYSTEM_OVERVIEW.md](./docs/architecture/SYSTEM_OVERVIEW.md) |
| Tables, columns, lifecycle | [DATA_MODEL.md](./docs/architecture/DATA_MODEL.md) |
| Tenant isolation | [MULTI_TENANCY.md](./docs/architecture/MULTI_TENANCY.md) |
| How async imports work, and every measurement | [ASYNC_IMPORT_ARCHITECTURE.md](./docs/architecture/ASYNC_IMPORT_ARCHITECTURE.md) |
| How to operate an import | [CATALOG_INTAKE_OPERATOR_GUIDE.md](./docs/user-guides/CATALOG_INTAKE_OPERATOR_GUIDE.md) |
| Azure resources, packaging, rollback | [AZURE_INFRASTRUCTURE.md](./docs/deployment/AZURE_INFRASTRUCTURE.md) |
| Why something was postponed | [DEFERRED_BACKLOG.md](./docs/DEFERRED_BACKLOG.md) |

---

## 9. Next

**Phase 1.1 — PDF Intake.** Not started, and not to be started without explicit instruction.

Two things to settle in its design rather than inherit:

- **Provenance must distinguish an inference from a transcription.** An extracted field is not the same kind of fact as a parsed CSV cell, and the current `normalizationMethod` is the likely extension point.
- **DB-013 (staging) should be re-evaluated, not assumed settled.** Extraction is expensive and lossy in a way CSV parsing is not, and extracted state plausibly needs durable operator review before commit — both of staging's core justifications.

Worth doing at some point, unrelated to the next phase: benchmark the update path from inside the App Service rather than from a remote host, to size how much of DB-017's ~24 ms per UPDATE is latency rather than work.
