/**
 * 10,000-row operator acceptance (Phase 1.0.2, Increment B, step 10).
 *
 * Drives the running API exactly as the Catalog Intake screen does — upload,
 * confirm, then poll — against a real PostgreSQL instance and the real
 * in-process worker. The benchmark harness calls `executeImport` directly, so it
 * proves throughput but not the operator promise. This proves the promise:
 * confirm returns immediately, the operator may walk away, and the import
 * finishes on its own with counts that reconcile.
 *
 * Synthetic data only. It creates its own organizations and catalogs, prefixed
 * [ACCEPT], and removes them at the end.
 *
 * A neighbouring organization and a second catalog in the same organization are
 * seeded with the SAME SKUs the import carries. Neither may be touched — that is
 * the tenant and catalog isolation check, run against live data rather than
 * asserted from the code.
 *
 * Usage (with the API already listening on API_BASE):
 *   npx tsx test/acceptance/ten-thousand-row-import.ts
 */
import { PrismaClient } from "@prisma/client";

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001/api/v1";
const TOKEN = process.env.DEV_AUTH_TOKEN ?? "dk-dev-internal-2026";
const ROWS = Number(process.env.ACCEPT_ROWS ?? 10_000);

const ORG = "90000000-0000-0000-0000-000000000001";
const CATALOG = "90000000-0000-0000-0000-000000000002";
/** Same organization, different catalog. Catalog scoping must hold inside a tenant. */
const SIBLING_CATALOG = "90000000-0000-0000-0000-000000000003";
/** A different tenant entirely. */
const NEIGHBOUR_ORG = "90000000-0000-0000-0000-000000000004";
const NEIGHBOUR_CATALOG = "90000000-0000-0000-0000-000000000005";

const DEV_EXTERNAL_ID = "dev-user-001";

const prisma = new PrismaClient();

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sku(i: number): string {
  return `ACCEPT-${String(i).padStart(6, "0")}`;
}

function makeCsv(rows: number): string {
  const lines = ["sku,gtin,brand,title,description,category,manufacturer"];
  for (let i = 1; i <= rows; i++) {
    lines.push(`${sku(i)},,AcceptCo,Product ${i},Description for product ${i},Category ${i % 11},AcceptCo`);
  }
  return lines.join("\n");
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "x-organization-id": ORG, ...extra };
}

async function seed(): Promise<void> {
  for (const [id, name] of [[ORG, "[ACCEPT] Primary"], [NEIGHBOUR_ORG, "[ACCEPT] Neighbour"]] as const) {
    await prisma.organization.upsert({
      where: { id }, update: {},
      create: { id, name, slug: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${Date.now()}`, status: "active" },
    });
  }
  await prisma.catalog.upsert({
    where: { id: CATALOG }, update: {},
    create: { id: CATALOG, organizationId: ORG, name: "[ACCEPT] Target", catalogType: "test" },
  });
  await prisma.catalog.upsert({
    where: { id: SIBLING_CATALOG }, update: {},
    create: { id: SIBLING_CATALOG, organizationId: ORG, name: "[ACCEPT] Sibling", catalogType: "test" },
  });
  await prisma.catalog.upsert({
    where: { id: NEIGHBOUR_CATALOG }, update: {},
    create: { id: NEIGHBOUR_CATALOG, organizationId: NEIGHBOUR_ORG, name: "[ACCEPT] Neighbour", catalogType: "test" },
  });

  // The operator identity the development auth provider presents.
  const user = await prisma.user.upsert({
    where: { externalIdentityId: DEV_EXTERNAL_ID }, update: {},
    create: {
      externalIdentityId: DEV_EXTERNAL_ID, email: "dev@datakitchen.local",
      displayName: "Development User", status: "active",
    },
  });
  await prisma.organizationMembership.upsert({
    where: { uq_membership_org_user: { organizationId: ORG, userId: user.id } },
    update: { status: "active", role: "organization_admin" },
    create: { organizationId: ORG, userId: user.id, role: "organization_admin", status: "active" },
  });

  // Decoys: identical SKUs in a sibling catalog and in another tenant.
  for (const [catalogId, organizationId] of [[SIBLING_CATALOG, ORG], [NEIGHBOUR_CATALOG, NEIGHBOUR_ORG]] as const) {
    await prisma.canonicalProduct.deleteMany({ where: { catalogId } });
    await prisma.canonicalProduct.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        organizationId, catalogId, sku: sku(i + 1),
        productName: `DECOY must not change ${i + 1}`,
        brand: "DecoyCo", lifecycleStatus: "draft", dataQualityStatus: "complete",
        createdBy: "acceptance-decoy", updatedBy: "acceptance-decoy",
      })),
    });
  }
}

async function cleanup(): Promise<void> {
  for (const catalogId of [CATALOG, SIBLING_CATALOG, NEIGHBOUR_CATALOG]) {
    await prisma.canonicalProductHistory.deleteMany({ where: { canonicalProduct: { catalogId } } });
    await prisma.fieldProvenance.deleteMany({ where: { canonicalProduct: { catalogId } } });
    await prisma.sourceRecord.deleteMany({ where: { importBatch: { catalogId } } });
    await prisma.canonicalProduct.deleteMany({ where: { catalogId } });
    await prisma.importBatch.deleteMany({ where: { catalogId } });
  }
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [ORG, NEIGHBOUR_ORG] } } });
  // Confirming an import saves the mapping the operator approved, so the run
  // leaves a template behind too.
  await prisma.mappingTemplate.deleteMany({ where: { organizationId: { in: [ORG, NEIGHBOUR_ORG] } } });
  await prisma.catalog.deleteMany({ where: { id: { in: [CATALOG, SIBLING_CATALOG, NEIGHBOUR_CATALOG] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [ORG, NEIGHBOUR_ORG] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG, NEIGHBOUR_ORG] } } });
}

async function main(): Promise<void> {
  console.log(`\n10,000-row operator acceptance — ${ROWS} rows against ${API_BASE}\n`);
  await cleanup();
  await seed();

  // --- Upload -------------------------------------------------------------
  const csv = makeCsv(ROWS);
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), `accept_${ROWS}.csv`);

  const uploadStart = Date.now();
  const uploadRes = await fetch(`${API_BASE}/catalogs/${CATALOG}/imports`, {
    method: "POST", headers: headers(), body: form,
  });
  const uploadBody = await uploadRes.json() as { data?: Record<string, any>; error?: unknown };
  const uploadMs = Date.now() - uploadStart;

  if (uploadRes.status !== 201) {
    console.error("upload failed", uploadRes.status, JSON.stringify(uploadBody).slice(0, 500));
    process.exit(1);
  }
  const importBatchId: string = uploadBody.data!.importBatchId;
  const projection = uploadBody.data!.projection;
  console.log(`  upload: ${uploadMs}ms, batch ${importBatchId}`);

  check("upload parses every row", uploadBody.data!.preview.totalRows === ROWS,
        `${uploadBody.data!.preview.totalRows} rows`);
  // The decoys share SKUs but live elsewhere, so the projection must see none
  // of them: this is the preview half of the isolation check.
  check("preview projects all rows as creates, ignoring other catalogs",
        projection.willCreate === ROWS && projection.willUpdate === 0,
        `willCreate=${projection.willCreate} willUpdate=${projection.willUpdate}`);

  // --- Confirm ------------------------------------------------------------
  const mappings = {
    sku: "sku", brand: "brand", product_name: "title",
    long_description: "description", category: "category", manufacturer: "manufacturer",
  };
  const confirmStart = Date.now();
  const confirmRes = await fetch(`${API_BASE}/imports/${importBatchId}/confirm`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ fieldMappings: mappings }),
  });
  const confirmMs = Date.now() - confirmStart;
  const confirmBody = await confirmRes.json() as { data?: Record<string, any> };

  check("confirm returns 202", confirmRes.status === 202, `status ${confirmRes.status}`);
  check("confirm returns promptly", confirmMs < 3000, `${confirmMs}ms`);
  check("confirm reports the import as queued, not finished",
        confirmBody.data?.status === "queued", String(confirmBody.data?.status));

  // --- The operator closes the browser -----------------------------------
  // Nothing polls, nothing holds a connection. The worker owns the run.
  console.log("\n  operator closes the browser (20s with no client contact)...");
  await new Promise((r) => setTimeout(r, 20_000));

  const afterSilence = await fetch(`${API_BASE}/imports/${importBatchId}/status`, { headers: headers() })
    .then((r) => r.json()) as { data: Record<string, any> };
  check("import ran on without a client attached",
        afterSilence.data.progressRows > 0,
        `progress ${afterSilence.data.progressRows}/${ROWS}, status ${afterSilence.data.status}`);

  // --- Poll to terminal ---------------------------------------------------
  const samples: Array<{ atMs: number; progressRows: number; status: string }> = [];
  const pollStart = Date.now();
  let status = afterSilence.data;
  while (!status.isTerminal) {
    if (Date.now() - pollStart > 15 * 60_000) break;
    await new Promise((r) => setTimeout(r, 2000));
    status = (await fetch(`${API_BASE}/imports/${importBatchId}/status`, { headers: headers() })
      .then((r) => r.json()) as { data: Record<string, any> }).data;
    samples.push({ atMs: Date.now() - pollStart, progressRows: status.progressRows, status: status.status });
  }

  const distinctProgress = new Set(samples.map((s) => s.progressRows));
  check("progress advanced while polling", distinctProgress.size > 1 || afterSilence.data.progressRows < ROWS,
        `${distinctProgress.size} distinct progress values across ${samples.length} polls`);
  check("import reached a terminal state", status.isTerminal === true, status.status);
  check("terminal status is a success", ["completed", "completed_with_warnings"].includes(status.status), status.status);

  const elapsedMs = status.elapsedMs ?? 0;
  console.log(`\n  wall clock (worker): ${elapsedMs}ms — ${Math.round((ROWS / elapsedMs) * 1000)} rows/sec`);

  // --- Import History -----------------------------------------------------
  const history = await fetch(`${API_BASE}/catalogs/${CATALOG}/imports`, { headers: headers() })
    .then((r) => r.json()) as { data: Array<Record<string, any>> };
  const entry = history.data.find((h) => h.id === importBatchId);
  check("Import History lists the run with its terminal status",
        entry?.status === status.status, `history says ${entry?.status}`);
  check("Import History reports the row counts",
        entry?.totalRows === ROWS && entry?.successfulRows === ROWS,
        `total ${entry?.totalRows}, successful ${entry?.successfulRows}`);

  // --- Terminal counts reconcile -----------------------------------------
  const results = await fetch(`${API_BASE}/imports/${importBatchId}/results`, { headers: headers() })
    .then((r) => r.json()) as { data: Record<string, any> };
  check("results reconcile with the file",
        results.data.totalRows === ROWS
          && results.data.successfulRows === ROWS
          && results.data.failedRows === 0,
        `total ${results.data.totalRows}, successful ${results.data.successfulRows}, failed ${results.data.failedRows}`);
  check("results report every row as a new product",
        results.data.createdProducts === ROWS && results.data.updatedProducts === 0,
        `created ${results.data.createdProducts}, updated ${results.data.updatedProducts}`);

  // --- Stored totals reconcile -------------------------------------------
  const [products, sourceRecords, distinctRows, provenance, historyRows] = await Promise.all([
    prisma.canonicalProduct.count({ where: { catalogId: CATALOG } }),
    prisma.sourceRecord.count({ where: { importBatchId } }),
    prisma.sourceRecord.groupBy({ by: ["rowNumber"], where: { importBatchId } }).then((g) => g.length),
    prisma.fieldProvenance.count({ where: { canonicalProduct: { catalogId: CATALOG } } }),
    prisma.canonicalProductHistory.count({ where: { canonicalProduct: { catalogId: CATALOG } } }),
  ]);

  check("one canonical product per row", products === ROWS, `${products} products`);
  check("one source record per row", sourceRecords === ROWS, `${sourceRecords} source records`);
  check("no row committed twice", distinctRows === ROWS, `${distinctRows} distinct row numbers`);
  // Six mapped fields per row, all populated.
  check("provenance covers every mapped field of every row", provenance === ROWS * 6, `${provenance} entries`);
  check("a first import writes no history", historyRows === 0, `${historyRows} entries`);

  // --- Isolation ----------------------------------------------------------
  const wrongOrg = await prisma.canonicalProduct.count({
    where: { catalogId: CATALOG, NOT: { organizationId: ORG } },
  });
  const siblingUntouched = await prisma.canonicalProduct.count({
    where: { catalogId: SIBLING_CATALOG, updatedBy: "acceptance-decoy" },
  });
  const neighbourUntouched = await prisma.canonicalProduct.count({
    where: { catalogId: NEIGHBOUR_CATALOG, updatedBy: "acceptance-decoy" },
  });
  const decoyHistory = await prisma.canonicalProductHistory.count({
    where: { canonicalProduct: { catalogId: { in: [SIBLING_CATALOG, NEIGHBOUR_CATALOG] } } },
  });

  check("every imported product carries the importing organization", wrongOrg === 0, `${wrongOrg} strays`);
  check("the sibling catalog's identical SKUs were not touched", siblingUntouched === 25, `${siblingUntouched}/25 intact`);
  check("the neighbouring tenant's identical SKUs were not touched", neighbourUntouched === 25, `${neighbourUntouched}/25 intact`);
  check("no history was written outside the target catalog", decoyHistory === 0, `${decoyHistory} entries`);

  // --- What the pipeline measured about itself ---------------------------
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: importBatchId } });
  const timings = ((batch.parseMetadata ?? {}) as Record<string, any>).timings;
  if (timings) {
    console.log("\n  pipeline timings (ms):", JSON.stringify(timings));
    check("database work scaled by chunk", timings.chunks === Math.ceil(ROWS / timings.chunkSize),
          `${timings.chunks} chunks of ${timings.chunkSize}`);
    check("no chunk needed row-by-row isolation", timings.isolatedChunks === 0,
          `${timings.isolatedChunks} isolated`);
    check("worker heap stayed modest", timings.peakHeapMb < 512, `${timings.peakHeapMb} MB heap, ${timings.peakRssMb} MB RSS`);
  }

  // --- Verdict ------------------------------------------------------------
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? "ACCEPTED" : "REJECTED"} — ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.detail}`);

  if (process.env.ACCEPT_KEEP !== "1") await cleanup();
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
