/**
 * Import throughput harness (Phase 1.0.2 Increment B).
 *
 * Measures the real commit pipeline against a real PostgreSQL instance and
 * counts every statement Prisma issues, so "N+1 removed" is a measurement
 * rather than a claim.
 *
 * Runs against a dedicated benchmark organization and catalog, created and torn
 * down by the harness, so it never touches operator data.
 *
 * Three workloads, because they exercise genuinely different code paths:
 *
 *   create   every row is a new product. Bulk insert throughout — this is the
 *            workload the Increment B baseline was measured on.
 *   update   every row matches an existing product and changes it. One UPDATE
 *            statement per product, deliberately (see ADR-027), so this is the
 *            path where work still scales with rows.
 *   mixed    10% creates, 30% updates, 60% unchanged, interleaved so no chunk
 *            sees only one kind. The closest thing here to a re-export of a
 *            supplier catalog with some drift.
 *
 * A non-create workload seeds its catalog with a preparatory import first. The
 * seed is not measured; counting starts immediately before the run under test.
 *
 * Usage:
 *   BENCH_ROWS=100,500,1000 npx tsx test/bench/import-bench.ts
 *   BENCH_SPEC=1000:update,5000:update,10000:mixed npx tsx test/bench/import-bench.ts
 */
import { PrismaClient } from "@prisma/client";
import { ImportService } from "../../src/services/import.service.js";
import { createStorageProvider } from "../../src/storage/storage.factory.js";
import { loadConfig } from "../../src/config.js";
import type { TenantContext } from "../../src/auth/types.js";

const BENCH_ORG = "60000000-0000-0000-0000-000000000001";
const BENCH_CATALOG_PREFIX = "60000000-0000-0000-0000-0000000000";

export type Workload = "create" | "update" | "mixed";

/** Mixed-workload composition. Interleaved by index, not blocked. */
const MIXED_CREATE_IN_TEN = 1;
const MIXED_UPDATE_IN_TEN = 3;

interface StatementCounts {
  total: number;
  byTable: Record<string, number>;
  /** Keyed `table.verb`, so an UPDATE can be told from a SELECT on one table. */
  byOperation: Record<string, number>;
  transactions: number;
}

export interface BenchResult {
  rows: number;
  workload: Workload;
  totalMs: number;
  blobMs: number;
  parseMs: number;
  /** Batched match resolution — one query per chunk since Increment B. */
  matchMs: number;
  /** Reading the products a chunk will update. */
  readMs: number;
  /** In-memory chunk planning. */
  planMs: number;
  /** Canonical product writes: bulk creates plus per-product updates. */
  canonicalMs: number;
  sourceMs: number;
  provenanceMs: number;
  historyMs: number;
  progressMs: number;
  /** Total time inside chunk transactions. */
  commitMs: number;
  chunks: number;
  chunkSize: number;
  rowsPerSec: number;
  statements: number;
  statementsPerRow: number;
  transactions: number;
  byTable: Record<string, number>;
  byOperation: Record<string, number>;
  /** The statement class ADR-027 knowingly left scaling with rows. */
  canonicalUpdateStatements: number;
  canonicalInsertStatements: number;
  canonicalSelectStatements: number;
  peakHeapMb: number;
  peakRssMb: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Rows actually persisted, read back from the database after the run. */
  sourceRecordRows: number;
  provenanceRows: number;
  historyRows: number;
  status: string;
}

/** Counts statements by inspecting Prisma's query event stream. */
function attachCounter(prisma: PrismaClient): { counts: StatementCounts; reset: () => void } {
  const counts: StatementCounts = { total: 0, byTable: {}, byOperation: {}, transactions: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$on("query", (e: { query: string }) => {
    counts.total++;
    const q = e.query;
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(q)) {
      if (/^\s*BEGIN/i.test(q)) counts.transactions++;
      return;
    }
    const m = q.match(/(?:FROM|INTO|UPDATE)\s+"?public"?\.?"?([a-z_]+)"?/i);
    const table = m?.[1] ?? "other";
    counts.byTable[table] = (counts.byTable[table] ?? 0) + 1;

    const verb = q.match(/^\s*(SELECT|INSERT|UPDATE|DELETE)/i)?.[1]?.toLowerCase() ?? "other";
    const key = `${table}.${verb}`;
    counts.byOperation[key] = (counts.byOperation[key] ?? 0) + 1;
  });
  return {
    counts,
    reset: () => {
      counts.total = 0;
      counts.transactions = 0;
      for (const k of Object.keys(counts.byTable)) delete counts.byTable[k];
      for (const k of Object.keys(counts.byOperation)) delete counts.byOperation[k];
    },
  };
}

const HEADER = "sku,gtin,brand,title,description,category,manufacturer\n";

/**
 * One row, in one of two revisions.
 *
 * Revision 1 is what the seed import writes. A row emitted at revision 1 in the
 * measured file is therefore byte-identical to what the catalog already holds
 * and must take the UNCHANGED path; revision 2 differs in four fields and must
 * take the UPDATE path.
 */
function line(tag: string, i: number, revision: 1 | 2): string {
  const sku = `BENCH-${tag}-${String(i).padStart(6, "0")}`;
  return revision === 1
    ? `${sku},,BenchCo,Bench Product ${i},Description ${i},Category ${i % 7},BenchCo`
    : `${sku},,BenchCo Revised,Bench Product ${i} v2,Description ${i} revised,Category ${(i + 1) % 7},BenchCo`;
}

/** Which path each row of the measured file is expected to take. */
function plannedAction(workload: Workload, i: number): "create" | "update" | "unchanged" {
  if (workload === "create") return "create";
  if (workload === "update") return "update";
  const slot = i % 10;
  if (slot < MIXED_CREATE_IN_TEN) return "create";
  if (slot < MIXED_CREATE_IN_TEN + MIXED_UPDATE_IN_TEN) return "update";
  return "unchanged";
}

/** The catalog state a workload needs before the measured run. */
function makeSeedCsv(tag: string, rows: number, workload: Workload): Buffer | null {
  if (workload === "create") return null;
  const lines: string[] = [];
  for (let i = 1; i <= rows; i++) {
    // Only rows the measured file will match need to exist beforehand.
    if (plannedAction(workload, i) === "create") continue;
    lines.push(line(tag, i, 1));
  }
  return Buffer.from(HEADER + lines.join("\n"), "utf-8");
}

function makeCsv(tag: string, rows: number, workload: Workload): Buffer {
  const lines: string[] = [];
  for (let i = 1; i <= rows; i++) {
    const action = plannedAction(workload, i);
    // A create in the mixed workload uses a SKU the seed never wrote.
    const sku = action === "create" && workload === "mixed" ? `${tag}-new` : tag;
    lines.push(line(sku, i, action === "unchanged" ? 1 : 2));
  }
  return Buffer.from(HEADER + lines.join("\n"), "utf-8");
}

async function ensureFixtures(prisma: PrismaClient, catalogId: string): Promise<void> {
  await prisma.organization.upsert({
    where: { id: BENCH_ORG },
    update: {},
    create: { id: BENCH_ORG, name: "[BENCH] Throughput", slug: `bench-throughput-${Date.now()}`, status: "active" },
  });
  await prisma.catalog.upsert({
    where: { id: catalogId },
    update: {},
    create: { id: catalogId, organizationId: BENCH_ORG, name: `[BENCH] ${catalogId.slice(-2)}`, catalogType: "test" },
  });
}

async function cleanCatalog(prisma: PrismaClient, catalogId: string): Promise<void> {
  await prisma.canonicalProductHistory.deleteMany({ where: { canonicalProduct: { catalogId } } });
  await prisma.fieldProvenance.deleteMany({ where: { canonicalProduct: { catalogId } } });
  await prisma.sourceRecord.deleteMany({ where: { importBatch: { catalogId } } });
  await prisma.canonicalProduct.deleteMany({ where: { catalogId } });
  await prisma.importBatch.deleteMany({ where: { catalogId } });
}

const MAPPINGS = {
  sku: "sku", brand: "brand", product_name: "title",
  long_description: "description", category: "category", manufacturer: "manufacturer",
};

/** Uploads, confirms and executes one import. Returns the batch id. */
async function runImport(
  svc: ImportService,
  prisma: PrismaClient,
  ctx: TenantContext,
  catalogId: string,
  filename: string,
  csv: Buffer,
  chunkSize: number,
) {
  const upload = await svc.uploadAndPreview(ctx, catalogId, filename, csv);
  await svc.enqueueImport(ctx, upload.importBatchId, MAPPINGS as never);
  await prisma.importBatch.update({
    where: { id: upload.importBatchId },
    data: {
      status: "processing", lockedBy: "bench", startedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 3_600_000), attempts: 1,
    },
  });
  const result = await svc.executeImport(upload.importBatchId, {
    workerId: "bench", leaseMs: 3_600_000, chunkSize,
  });
  return { importBatchId: upload.importBatchId, result };
}

export async function runBench(
  prisma: PrismaClient,
  rows: number,
  index: number,
  workload: Workload = "create",
): Promise<BenchResult> {
  const config = loadConfig();
  const storage = createStorageProvider(config.storage);
  const svc = new ImportService(prisma, storage, config);
  const catalogId = `${BENCH_CATALOG_PREFIX}${String(index).padStart(2, "0")}`;
  const chunkSize = config.imports.chunkSize;
  const tag = `${workload}${rows}`;

  await ensureFixtures(prisma, catalogId);
  await cleanCatalog(prisma, catalogId);

  const ctx = {
    organizationId: BENCH_ORG, catalogId, userId: "bench",
    role: "organization_admin", displayName: "bench",
  } as unknown as TenantContext;

  // Seed the catalog for update/mixed. Not measured — the run under test is the
  // second import, against a catalog that already holds these products.
  const seed = makeSeedCsv(tag, rows, workload);
  if (seed) {
    await runImport(svc, prisma, ctx, catalogId, `seed_${tag}.csv`, seed, chunkSize);
  }

  const { counts, reset } = attachCounter(prisma);
  reset();

  let peakHeap = 0;
  let peakRss = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
  }, 100);

  const csv = makeCsv(tag, rows, workload);
  const upload = await svc.uploadAndPreview(ctx, catalogId, `bench_${tag}.csv`, csv);
  await svc.enqueueImport(ctx, upload.importBatchId, MAPPINGS as never);
  await prisma.importBatch.update({
    where: { id: upload.importBatchId },
    data: {
      status: "processing", lockedBy: "bench", startedAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 3_600_000), attempts: 1,
    },
  });

  // Count only the commit phase, so upload and preview do not inflate the
  // per-row statement figure the whole exercise is about.
  reset();
  const t0 = Date.now();
  const result = await svc.executeImport(upload.importBatchId, {
    workerId: "bench", leaseMs: 3_600_000, chunkSize,
  });
  const totalMs = Date.now() - t0;
  clearInterval(sampler);

  // Phase timings come from the pipeline itself rather than being inferred from
  // the outside, so "where did the time go" is answered by the code that spent
  // it. They are also persisted on the batch for post-hoc investigation.
  const t = result.timings;

  const [sourceRecordRows, provenanceRows, historyRows] = await Promise.all([
    prisma.sourceRecord.count({ where: { importBatchId: upload.importBatchId } }),
    prisma.fieldProvenance.count({ where: { sourceRecord: { importBatchId: upload.importBatchId } } }),
    prisma.canonicalProductHistory.count({ where: { sourceRecord: { importBatchId: upload.importBatchId } } }),
  ]);

  return {
    rows,
    workload,
    totalMs,
    blobMs: t.blobMs,
    parseMs: t.parseMs,
    matchMs: t.matchMs,
    readMs: t.readMs,
    planMs: t.planMs,
    canonicalMs: t.canonicalMs,
    sourceMs: t.sourceMs,
    provenanceMs: t.provenanceMs,
    historyMs: t.historyMs,
    progressMs: t.progressMs,
    commitMs: t.commitMs,
    chunks: t.chunks,
    chunkSize: t.chunkSize,
    rowsPerSec: Math.round((rows / totalMs) * 1000 * 10) / 10,
    statements: counts.total,
    statementsPerRow: Math.round((counts.total / rows) * 100) / 100,
    transactions: counts.transactions,
    byTable: { ...counts.byTable },
    byOperation: { ...counts.byOperation },
    canonicalUpdateStatements: counts.byOperation["canonical_product.update"] ?? 0,
    canonicalInsertStatements: counts.byOperation["canonical_product.insert"] ?? 0,
    canonicalSelectStatements: counts.byOperation["canonical_product.select"] ?? 0,
    peakHeapMb: Math.round(peakHeap / 1048576),
    peakRssMb: Math.round(peakRss / 1048576),
    created: result.createdProducts,
    updated: result.updatedProducts,
    unchanged: result.unchangedProducts,
    sourceRecordRows,
    provenanceRows,
    historyRows,
    status: result.status,
  };
}

interface Spec { rows: number; workload: Workload }

function parseSpecs(): Spec[] {
  const raw = process.env.BENCH_SPEC;
  if (raw) {
    return raw.split(",").map((entry) => {
      const [rows, workload] = entry.trim().split(":");
      return { rows: Number(rows), workload: (workload ?? "create") as Workload };
    });
  }
  return (process.env.BENCH_ROWS ?? "100,500,1000")
    .split(",")
    .map((s) => ({ rows: Number(s.trim()), workload: "create" as Workload }));
}

async function main(): Promise<void> {
  const specs = parseSpecs();
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });

  const results: BenchResult[] = [];
  for (const [i, spec] of specs.entries()) {
    process.stdout.write(`  running ${spec.rows} rows (${spec.workload})...`);
    const r = await runBench(prisma, spec.rows, i, spec.workload);
    results.push(r);
    process.stdout.write(` ${r.totalMs}ms, ${r.statements} statements\n`);
  }

  console.log("\n| rows | workload | total ms | rows/s | statements | stmt/row | txns | chunks | heap MB | rss MB | status |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.workload} | ${r.totalMs} | ${r.rowsPerSec} | ${r.statements} | ${r.statementsPerRow} | ${r.transactions} | ${r.chunks} | ${r.peakHeapMb} | ${r.peakRssMb} | ${r.status} |`);
  }

  console.log("\n| rows | workload | blob | parse | match | read | plan | canonical | source | provenance | history | progress | commit |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.workload} | ${r.blobMs} | ${r.parseMs} | ${r.matchMs} | ${r.readMs} | ${r.planMs} | ${r.canonicalMs} | ${r.sourceMs} | ${r.provenanceMs} | ${r.historyMs} | ${r.progressMs} | ${r.commitMs} |`);
  }

  console.log("\n| rows | workload | created | updated | unchanged | canonical UPDATEs | canonical INSERTs | canonical SELECTs |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.workload} | ${r.created} | ${r.updated} | ${r.unchanged} | ${r.canonicalUpdateStatements} | ${r.canonicalInsertStatements} | ${r.canonicalSelectStatements} |`);
  }

  console.log("\n| rows | workload | source records | provenance | history |");
  console.log("|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.workload} | ${r.sourceRecordRows} | ${r.provenanceRows} | ${r.historyRows} |`);
  }

  console.log("\nStatements by operation (largest run):");
  const last = results[results.length - 1];
  for (const [op, n] of Object.entries(last.byOperation).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${op.padEnd(34)} ${n}`);
  }

  for (const [i] of specs.entries()) {
    await cleanCatalog(prisma, `${BENCH_CATALOG_PREFIX}${String(i).padStart(2, "0")}`);
    await prisma.catalog.deleteMany({ where: { id: `${BENCH_CATALOG_PREFIX}${String(i).padStart(2, "0")}` } });
  }
  await prisma.organization.deleteMany({ where: { id: BENCH_ORG } });
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("import-bench")) {
  void main();
}
