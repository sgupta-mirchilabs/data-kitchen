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
 * Usage:
 *   BENCH_ROWS=100,500,1000 npx tsx test/bench/import-bench.ts
 */
import { PrismaClient } from "@prisma/client";
import { ImportService } from "../../src/services/import.service.js";
import { createStorageProvider } from "../../src/storage/storage.factory.js";
import { loadConfig } from "../../src/config.js";
import type { TenantContext } from "../../src/auth/types.js";

const BENCH_ORG = "60000000-0000-0000-0000-000000000001";
const BENCH_CATALOG_PREFIX = "60000000-0000-0000-0000-0000000000";

interface StatementCounts {
  total: number;
  byTable: Record<string, number>;
  transactions: number;
}

export interface BenchResult {
  rows: number;
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
  peakHeapMb: number;
  peakRssMb: number;
  created: number;
  updated: number;
  unchanged: number;
  status: string;
}

/** Counts statements by inspecting Prisma's query event stream. */
function attachCounter(prisma: PrismaClient): { counts: StatementCounts; reset: () => void } {
  const counts: StatementCounts = { total: 0, byTable: {}, transactions: 0 };
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
  });
  return {
    counts,
    reset: () => {
      counts.total = 0;
      counts.transactions = 0;
      for (const k of Object.keys(counts.byTable)) delete counts.byTable[k];
    },
  };
}

function makeCsv(rows: number): Buffer {
  const header = "sku,gtin,brand,title,description,category,manufacturer\n";
  const lines: string[] = [];
  for (let i = 1; i <= rows; i++) {
    // Deterministic, obviously synthetic, and unique per run size.
    lines.push(`BENCH-${rows}-${String(i).padStart(6, "0")},,BenchCo,Bench Product ${i},Description ${i},Category ${i % 7},BenchCo`);
  }
  return Buffer.from(header + lines.join("\n"), "utf-8");
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

export async function runBench(prisma: PrismaClient, rows: number, index: number): Promise<BenchResult> {
  const config = loadConfig();
  const storage = createStorageProvider(config.storage);
  const svc = new ImportService(prisma, storage, config);
  const catalogId = `${BENCH_CATALOG_PREFIX}${String(index).padStart(2, "0")}`;

  await ensureFixtures(prisma, catalogId);
  await cleanCatalog(prisma, catalogId);

  const ctx = {
    organizationId: BENCH_ORG, catalogId, userId: "bench",
    role: "organization_admin", displayName: "bench",
  } as unknown as TenantContext;

  const upload = await svc.uploadAndPreview(ctx, catalogId, `bench_${rows}.csv`, makeCsv(rows));
  const mappings = {
    sku: "sku", brand: "brand", product_name: "title",
    long_description: "description", category: "category", manufacturer: "manufacturer",
  };
  await svc.enqueueImport(ctx, upload.importBatchId, mappings as never);

  const { counts, reset } = attachCounter(prisma);
  reset();

  let peakHeap = 0;
  let peakRss = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
  }, 100);

  // Drive execution directly so the measurement is of the pipeline, not of
  // poll latency.
  await prisma.importBatch.update({
    where: { id: upload.importBatchId },
    data: { status: "processing", lockedBy: "bench", lockExpiresAt: new Date(Date.now() + 3_600_000), startedAt: new Date(), attempts: 1 },
  });

  const t0 = Date.now();
  const result = await svc.executeImport(upload.importBatchId, {
    workerId: "bench", leaseMs: 3_600_000, chunkSize: config.imports.chunkSize,
  });
  const totalMs = Date.now() - t0;
  clearInterval(sampler);

  // Phase timings come from the pipeline itself rather than being inferred from
  // the outside, so "where did the time go" is answered by the code that spent
  // it. They are also persisted on the batch for post-hoc investigation.
  const t = result.timings;

  return {
    rows,
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
    peakHeapMb: Math.round(peakHeap / 1048576),
    peakRssMb: Math.round(peakRss / 1048576),
    created: result.createdProducts,
    updated: result.updatedProducts,
    unchanged: result.unchangedProducts,
    status: result.status,
  };
}

async function main(): Promise<void> {
  const sizes = (process.env.BENCH_ROWS ?? "100,500,1000").split(",").map((s) => Number(s.trim()));
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });

  const results: BenchResult[] = [];
  for (const [i, rows] of sizes.entries()) {
    process.stdout.write(`  running ${rows} rows...`);
    const r = await runBench(prisma, rows, i);
    results.push(r);
    process.stdout.write(` ${r.totalMs}ms, ${r.statements} statements\n`);
  }

  console.log("\n| rows | total ms | rows/s | statements | stmt/row | txns | chunks | heap MB | rss MB | status |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.totalMs} | ${r.rowsPerSec} | ${r.statements} | ${r.statementsPerRow} | ${r.transactions} | ${r.chunks} | ${r.peakHeapMb} | ${r.peakRssMb} | ${r.status} |`);
  }

  console.log("\n| rows | blob | parse | match | read | plan | canonical | source | provenance | history | progress | commit |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.blobMs} | ${r.parseMs} | ${r.matchMs} | ${r.readMs} | ${r.planMs} | ${r.canonicalMs} | ${r.sourceMs} | ${r.provenanceMs} | ${r.historyMs} | ${r.progressMs} | ${r.commitMs} |`);
  }

  console.log("\n| rows | created | updated | unchanged |");
  console.log("|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.rows} | ${r.created} | ${r.updated} | ${r.unchanged} |`);
  }

  console.log("\nStatements by table (largest run):");
  const last = results[results.length - 1];
  for (const [t, n] of Object.entries(last.byTable).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(28)} ${n}`);
  }

  for (const [i] of sizes.entries()) {
    await cleanCatalog(prisma, `${BENCH_CATALOG_PREFIX}${String(i).padStart(2, "0")}`);
    await prisma.catalog.deleteMany({ where: { id: `${BENCH_CATALOG_PREFIX}${String(i).padStart(2, "0")}` } });
  }
  await prisma.organization.deleteMany({ where: { id: BENCH_ORG } });
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("import-bench")) {
  void main();
}
