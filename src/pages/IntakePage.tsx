import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud, CheckCircle2, AlertTriangle,
  XCircle, Clock, ChevronRight, Search,
  Package, Database, FileSpreadsheet, History,
} from "lucide-react";
import { AppShell } from "../components/shell/AppShell";
import { ImportWizard } from "../components/catalog/ImportWizard";
import { ProductDetail } from "../components/catalog/ProductDetail";
import { ImportHistory } from "../components/catalog/ImportHistory";
import {
  getCatalogRepository,
  type CatalogRepository,
  type CatalogProduct,
  type CatalogStats,
  type ImportBatch,
} from "../lib/catalog-repository";
import { CatalogSelector } from "../components/catalog/CatalogSelector";
import {
  resolveActiveCatalog,
  readStoredCatalogId,
  writeStoredCatalogId,
  type CatalogSummary,
} from "../lib/catalog-selection";
import { getSelectedOrganization, getSelectedOrganizationName } from "../lib/api-client";

function QualityBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
    complete: { label: "Complete", color: "var(--green)", bg: "var(--green-dim)", icon: CheckCircle2 },
    missing_core_fields: { label: "Missing Fields", color: "var(--red)", bg: "var(--red-dim)", icon: XCircle },
    parse_warning: { label: "Parse Warning", color: "var(--amber)", bg: "var(--amber-dim)", icon: AlertTriangle },
    needs_review: { label: "Needs Review", color: "var(--amber)", bg: "var(--amber-dim)", icon: AlertTriangle },
    // Demo mode statuses
    ready: { label: "Ready", color: "var(--green)", bg: "var(--green-dim)", icon: CheckCircle2 },
    blocked: { label: "Blocked", color: "var(--red)", bg: "var(--red-dim)", icon: XCircle },
    pending: { label: "Pending", color: "var(--text-muted)", bg: "var(--surface-overlay)", icon: Clock },
  };
  const s = map[status] ?? map.needs_review;
  const Icon = s.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: s.color, background: s.bg }}>
      <Icon size={10} /> {s.label}
    </span>
  );
}

function NoticePanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        border: "2px dashed var(--border)",
        borderRadius: 10,
        padding: "56px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 52, height: 52, borderRadius: 14, background: "var(--surface-raised)",
          border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Database size={22} color="var(--text-muted)" />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 440 }}>{body}</div>
    </div>
  );
}

type View = "catalog" | "importing" | "history";

/** Whether a catalog is known yet, and if not, why. */
type CatalogPhase = "loading" | "ready" | "needs-selection" | "no-catalogs";

export function IntakePage() {
  const [repo, setRepo] = useState<CatalogRepository | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [catalogPhase, setCatalogPhase] = useState<CatalogPhase>("loading");
  // Captured once per mount. OrganizationGate reloads the app on switch, so a
  // change of organization always arrives as a fresh mount with fresh storage.
  const [organizationId] = useState<string | null>(() => getSelectedOrganization());
  const [organizationName] = useState<string | null>(() => getSelectedOrganizationName());
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("catalog");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadData = useCallback(async (repository: CatalogRepository, catId: string) => {
    const [productResult, catalogStats, importList] = await Promise.all([
      repository.getProducts(catId, { status: filterStatus, search: search || undefined }),
      repository.getCatalogStats(catId),
      repository.getImports(catId),
    ]);
    setProducts(productResult.products);
    setTotal(productResult.total);
    setStats(catalogStats);
    setImports(importList);
    setLoading(false);
  }, [filterStatus, search]);

  useEffect(() => {
    async function init() {
      try {
        const repository = await getCatalogRepository();
        setRepo(repository);

        // Catalogs are returned for the active organization only; the server
        // scopes by tenant context, so this list can never contain another
        // organization's catalogs.
        const list = await repository.getCatalogs();
        setCatalogs(list);

        const resolution = resolveActiveCatalog(list, readStoredCatalogId(organizationId));

        if (resolution.catalogId) {
          setCatalogId(resolution.catalogId);
          writeStoredCatalogId(organizationId, resolution.catalogId);
          setCatalogPhase("ready");
          await loadData(repository, resolution.catalogId);
        } else {
          // Either there are no catalogs, or there are several and none was
          // validly stored. Both cases require the operator to act; we do not
          // fall back to the first catalog.
          setCatalogId(null);
          setCatalogPhase(resolution.status === "no-catalogs" ? "no-catalogs" : "needs-selection");
          setLoading(false);
        }
      } catch {
        setCatalogPhase("no-catalogs");
        setLoading(false);
      }
    }
    init();
    // organizationId is fixed for the lifetime of this mount.
  }, [loadData, organizationId]);

  function handleSelectCatalog(nextId: string) {
    if (nextId === catalogId) return;
    // Drop the previous catalog's data immediately so it is never displayed
    // against the newly selected catalog while the refresh is in flight.
    setProducts([]);
    setStats(null);
    setImports([]);
    setTotal(0);
    setSelectedId(null);
    setView("catalog");
    setLoading(true);
    setCatalogId(nextId);
    setCatalogPhase("ready");
    writeStoredCatalogId(organizationId, nextId);
  }

  useEffect(() => {
    if (repo && catalogId) {
      loadData(repo, catalogId);
    }
  }, [filterStatus, search, repo, catalogId, loadData]);

  function handleImportComplete() {
    if (repo && catalogId) loadData(repo, catalogId);
  }

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const activeCatalog = catalogs.find((c) => c.id === catalogId) ?? null;
  const isEmpty = !loading && products.length === 0 && filterStatus === "all" && !search;

  const STATUSES: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    { key: "complete", label: "Complete" },
    { key: "missing_core_fields", label: "Missing Fields" },
    { key: "parse_warning", label: "Parse Warning" },
    { key: "needs_review", label: "Needs Review" },
  ];

  return (
    <AppShell>
      <div style={{ padding: "24px 28px", maxWidth: 1200 }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <UploadCloud size={14} color="var(--mirchi)" />
              <span style={{ fontSize: 11, color: "var(--mirchi)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Step 1 of 6
              </span>
              {repo && (
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 10,
                  color: repo.mode === "demo" ? "var(--amber)" : "var(--green)",
                  background: repo.mode === "demo" ? "var(--amber-dim)" : "var(--green-dim)",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {repo.mode}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Catalog Workspace
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Import and manage product data. Data Kitchen preserves original source records and tracks field provenance.
            </p>
            <div style={{ marginTop: 12 }}>
              <CatalogSelector
                organizationName={organizationName}
                catalogs={catalogs}
                activeCatalogId={catalogId}
                onSelect={handleSelectCatalog}
                disabled={view === "importing"}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {view === "catalog" && (
              <>
                <button
                  onClick={() => setView("history")}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                    borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-raised)",
                    color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  <History size={13} /> Import History
                </button>
                {repo?.mode === "live" && catalogId && (
                  <button
                    onClick={() => setView("importing")}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                      borderRadius: 6, border: "none", background: "var(--mirchi)",
                      color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <UploadCloud size={13} /> Import Products
                  </button>
                )}
              </>
            )}
            {view !== "catalog" && (
              <button
                onClick={() => setView("catalog")}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                  borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-raised)",
                  color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}
              >
                Back to Catalog
              </button>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* Import Wizard */}
          {view === "importing" && catalogId && (
            <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ImportWizard
                catalogId={catalogId}
                catalogName={activeCatalog?.name}
                catalogType={activeCatalog?.catalogType}
                onClose={() => setView("catalog")}
                onImportComplete={handleImportComplete}
              />
            </motion.div>
          )}

          {/* Import History */}
          {view === "history" && (
            <motion.div key="history" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ImportHistory imports={imports} onClose={() => setView("catalog")} />
              {imports.length === 0 && repo?.mode === "demo" && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                  Import history is not available in demo mode.
                </div>
              )}
            </motion.div>
          )}

          {/* Catalog View */}
          {view === "catalog" && (
            <motion.div key="catalog" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {catalogPhase === "no-catalogs" ? (
                <NoticePanel
                  title="No catalogs available"
                  body={`This organization${organizationName ? ` (${organizationName})` : ""} has no catalogs, so there is nowhere to import into. Create a catalog before importing products.`}
                />
              ) : catalogPhase === "needs-selection" ? (
                <NoticePanel
                  title="Select a catalog to continue"
                  body="This organization has more than one catalog. Choose the target catalog above — Data Kitchen will not pick one for you, because importing into the wrong catalog is not recoverable through the UI."
                />
              ) : loading ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  Loading catalog...
                </div>
              ) : isEmpty ? (
                /* Empty state for live mode */
                <div style={{
                  border: "2px dashed var(--border)", borderRadius: 10,
                  padding: "64px 24px", textAlign: "center",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 14, background: "var(--surface-raised)",
                    border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Package size={24} color="var(--text-muted)" />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                      No products yet
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 400, margin: "0 auto" }}>
                      Import a CSV or JSON file to start building your product catalog. Data Kitchen will parse, normalize, and preserve your source data.
                    </div>
                  </div>
                  {repo?.mode === "live" && catalogId && (
                    <button
                      onClick={() => setView("importing")}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "9px 20px",
                        borderRadius: 6, border: "none", background: "var(--mirchi)",
                        color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      <UploadCloud size={14} /> Import Products
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Stats bar */}
                  {stats && (
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1,
                      background: "var(--border)", borderRadius: 8, overflow: "hidden",
                      marginBottom: 20, border: "1px solid var(--border)",
                    }}>
                      {[
                        { icon: Package, label: "Products", value: String(stats.totalProducts) },
                        { icon: FileSpreadsheet, label: "With SKU", value: String(stats.productsWithSku) },
                        { icon: Database, label: "With GTIN", value: String(stats.productsWithGtin) },
                        { icon: AlertTriangle, label: "Missing Core", value: String(stats.missingCoreFields), warn: stats.missingCoreFields > 0 },
                        { icon: CheckCircle2, label: "Sources", value: stats.sourceSystems.length > 0 ? stats.sourceSystems.join(", ") : "—", small: true },
                      ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                          <div key={i} style={{ background: "var(--surface)", padding: "12px 14px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                              <Icon size={11} color={(s as any).warn ? "var(--amber)" : "var(--text-muted)"} />
                              <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</span>
                            </div>
                            <div style={{
                              fontSize: (s as any).small ? 11 : 18, fontWeight: 700,
                              color: (s as any).warn ? "var(--amber)" : "var(--text-primary)",
                              letterSpacing: (s as any).small ? 0 : "-0.02em",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}>
                              {s.value}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Filters */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 8,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "6px 10px",
                    }}>
                      <Search size={13} color="var(--text-muted)" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search products, SKUs, brands..."
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--text-primary)" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {STATUSES.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => setFilterStatus(f.key)}
                          style={{
                            padding: "5px 10px", borderRadius: 5, border: "1px solid",
                            borderColor: filterStatus === f.key ? "var(--mirchi-glow)" : "var(--border)",
                            background: filterStatus === f.key ? "var(--mirchi-dim)" : "var(--surface)",
                            color: filterStatus === f.key ? "var(--mirchi)" : "var(--text-muted)",
                            fontSize: 11, fontWeight: filterStatus === f.key ? 600 : 400, cursor: "pointer",
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Product table */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "2fr 120px 120px 140px 100px 24px",
                      padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-raised)",
                    }}>
                      {["Product / SKU", "Brand", "Category", "Data Quality", "Modified", ""].map((col) => (
                        <div key={col} style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{col}</div>
                      ))}
                    </div>

                    {products.map((p, i) => (
                        <div
                          key={p.id}
                          onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                          style={{
                            display: "grid", gridTemplateColumns: "2fr 120px 120px 140px 100px 24px",
                            padding: "10px 16px", borderBottom: i < products.length - 1 ? "1px solid var(--border-subtle)" : "none",
                            cursor: "pointer", alignItems: "center",
                            background: selectedId === p.id ? "var(--surface-raised)" : "transparent",
                            transition: "background 0.1s ease",
                          }}
                        >
                          <div style={{ paddingRight: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 340 }}>
                              {p.productName ?? "Unnamed Product"}
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                                {p.sku ?? "—"}
                              </span>
                              {p.gtin && (
                                <>
                                  <span style={{ fontSize: 10, color: "var(--border)" }}>·</span>
                                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>GTIN: {p.gtin}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                            {p.brand ?? "—"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                            {p.category ?? "—"}
                          </div>
                          <div>
                            <QualityBadge status={p.dataQualityStatus} />
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {new Date(p.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                          <div>
                            <ChevronRight size={12} color="var(--text-muted)" style={{ transform: selectedId === p.id ? "rotate(90deg)" : "none", transition: "transform 0.2s ease" }} />
                          </div>
                        </div>
                      ))}

                    {products.length === 0 && (
                      <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>No products match.</div>
                    )}
                  </div>

                  {/* Product detail */}
                  <AnimatePresence>
                    {selected && repo && (
                      <ProductDetail
                        key={selected.id}
                        product={selected}
                        repo={repo}
                        onClose={() => setSelectedId(null)}
                      />
                    )}
                  </AnimatePresence>

                  {/* Footer */}
                  <div style={{
                    marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--surface)",
                  }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {total} products{stats?.lastImport ? ` · Last import: ${new Date(stats.lastImport.uploadedAt).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
