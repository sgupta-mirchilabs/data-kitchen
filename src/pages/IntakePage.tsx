import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle,
  XCircle, Clock, ChevronRight, Search, Filter, RefreshCw,
  ArrowUpRight, Database, Layers, Package, ImageOff,
} from "lucide-react";
import { AppShell } from "../components/shell/AppShell";
import { PRODUCTS, CATALOG_STATS, type Product, type ProductStatus } from "../lib/seed-data";
import { Link } from "react-router-dom";

function StatusBadge({ status }: { status: ProductStatus }) {
  const map = {
    ready: { label: "Ready", color: "var(--green)", bg: "var(--green-dim)" },
    needs_review: { label: "Needs Review", color: "var(--amber)", bg: "var(--amber-dim)" },
    blocked: { label: "Blocked", color: "var(--red)", bg: "var(--red-dim)" },
    pending: { label: "Pending", color: "var(--text-muted)", bg: "var(--surface-overlay)" },
  };
  const s = map[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, color: s.color, background: s.bg }}>
      {status === "ready" && <CheckCircle2 size={10} />}
      {status === "needs_review" && <AlertTriangle size={10} />}
      {status === "blocked" && <XCircle size={10} />}
      {status === "pending" && <Clock size={10} />}
      {s.label}
    </span>
  );
}

function ReadinessBar({ score }: { score: number }) {
  const color = score >= 90 ? "var(--green)" : score >= 60 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 72, height: 4, borderRadius: 2, background: "var(--surface-overlay)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: color, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 28 }}>{score}%</span>
    </div>
  );
}

function SourceTag({ source }: { source: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    Product360: { color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
    Salsify: { color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
    Syndigo: { color: "#34d399", bg: "rgba(52,211,153,0.1)" },
    "ERP-SAP": { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  };
  const c = colors[source] ?? { color: "var(--text-muted)", bg: "var(--surface-overlay)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, color: c.color, background: c.bg, letterSpacing: "0.03em" }}>
      {source}
    </span>
  );
}

function ChannelDots({ channels }: { channels: Product["channels"] }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {channels.map((ch) => {
        const color = ch.status === "live" ? "var(--green)" : ch.status === "rejected" ? "var(--red)" : ch.status === "pending" ? "var(--amber)" : "var(--border)";
        return <div key={ch.channelId} title={`${ch.channel}: ${ch.status}`} style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />;
      })}
    </div>
  );
}

function UploadZone({ onImported }: { onImported: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  async function simulate() {
    if (importing || done) return;
    setImporting(true);
    await new Promise(r => setTimeout(r, 1800));
    setDone(true);
    await new Promise(r => setTimeout(r, 600));
    onImported();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); simulate(); }}
      onClick={simulate}
      style={{
        border: `2px dashed ${dragging ? "var(--mirchi)" : "var(--border)"}`,
        borderRadius: 10, padding: "48px 24px", textAlign: "center" as const,
        cursor: importing || done ? "default" : "pointer",
        background: dragging ? "var(--mirchi-dim)" : "var(--surface)",
        transition: "all 0.15s ease", display: "flex", flexDirection: "column" as const,
        alignItems: "center", gap: 12,
      }}
    >
      {!importing && !done && (
        <>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--surface-raised)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UploadCloud size={22} color="var(--text-muted)" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>Drop your Product360 export here</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>.xlsx · .csv · .json · PIM API export</div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {["Product360", "Salsify", "Syndigo", "ERP/SAP", "Custom CSV"].map(s => (
              <span key={s} style={{ fontSize: 11, color: "var(--text-muted)" }}>{s}</span>
            ))}
          </div>
          <div style={{ marginTop: 4, padding: "6px 16px", borderRadius: 6, background: "var(--mirchi)", color: "white", fontSize: 12, fontWeight: 600, display: "inline-block" }}>
            Browse file
          </div>
        </>
      )}
      {importing && !done && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 16 }}>
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
            <RefreshCw size={24} color="var(--mirchi)" />
          </motion.div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>Importing Product360_Export_2026-07-31.xlsx</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Profiling attributes · Detecting source schema · Calculating readiness…</div>
          </div>
        </motion.div>
      )}
      {done && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={32} color="var(--green)" />
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>6 products imported successfully</div>
        </motion.div>
      )}
    </motion.div>
  );
}

const STATS = [
  { icon: FileSpreadsheet, label: "Source File", value: "Product360_Export_2026-07-31.xlsx", small: true, warn: false, good: false },
  { icon: Package, label: "Products", value: String(CATALOG_STATS.totalProducts), small: false, warn: false, good: false },
  { icon: Database, label: "Attributes", value: String(CATALOG_STATS.totalAttributes), small: false, warn: false, good: false },
  { icon: Layers, label: "Avg Readiness", value: `${CATALOG_STATS.avgReadinessScore}%`, small: false, warn: false, good: false },
  { icon: AlertTriangle, label: "Issues", value: String(CATALOG_STATS.attributeIssues), small: false, warn: true, good: false },
  { icon: CheckCircle2, label: "Live Channels", value: String(CATALOG_STATS.liveChannels), small: false, warn: false, good: true },
];

export function IntakePage() {
  const [imported, setImported] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = PRODUCTS.filter(p => {
    const ms = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase());
    const mf = filterStatus === "all" || p.status === filterStatus;
    return ms && mf;
  });

  const selected = PRODUCTS.find(p => p.id === selectedId) ?? null;

  return (
    <AppShell>
      <div style={{ padding: "24px 28px", maxWidth: 1200 }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <UploadCloud size={14} color="var(--mirchi)" />
              <span style={{ fontSize: 11, color: "var(--mirchi)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>Step 1 of 6</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Catalog Intake</h1>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Import product data from your PIM, ERP, or data export. Data Kitchen profiles attributes and identifies gaps before retailer submission.</p>
          </div>
          {imported && (
            <button onClick={() => setImported(false)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              <UploadCloud size={13} /> New Import
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {!imported ? (
            <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <UploadZone onImported={() => setImported(true)} />
            </motion.div>
          ) : (
            <motion.div key="catalog" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              {/* Stats bar */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, background: "var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 20, border: "1px solid var(--border)" }}>
                {STATS.map((s, i) => {
                  const Icon = s.icon;
                  return (
                    <div key={i} style={{ background: "var(--surface)", padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                        <Icon size={11} color={s.warn ? "var(--amber)" : s.good ? "var(--green)" : "var(--text-muted)"} />
                        <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{s.label}</span>
                      </div>
                      <div style={{ fontSize: s.small ? 11 : 18, fontWeight: 700, color: s.warn ? "var(--amber)" : s.good ? "var(--green)" : "var(--text-primary)", letterSpacing: s.small ? 0 : "-0.02em", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.value}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Filters */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
                  <Search size={13} color="var(--text-muted)" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products, SKUs, brands…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--text-primary)" }} />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["all", "ready", "needs_review", "blocked", "pending"].map(f => (
                    <button key={f} onClick={() => setFilterStatus(f)} style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid", borderColor: filterStatus === f ? "var(--mirchi-glow)" : "var(--border)", background: filterStatus === f ? "var(--mirchi-dim)" : "var(--surface)", color: filterStatus === f ? "var(--mirchi)" : "var(--text-muted)", fontSize: 11, fontWeight: filterStatus === f ? 600 : 400, cursor: "pointer" }}>
                      {f === "needs_review" ? "Needs Review" : f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                  <Filter size={12} /> Filters
                </button>
              </div>

              {/* Table */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 110px 110px 80px 100px 24px", padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-raised)" }}>
                  {["Product / SKU", "Source", "Status", "Readiness", "Channels", "Modified", ""].map(col => (
                    <div key={col} style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>{col}</div>
                  ))}
                </div>

                <AnimatePresence>
                  {filtered.map((p, i) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                      style={{
                        display: "grid", gridTemplateColumns: "2fr 90px 110px 110px 80px 100px 24px",
                        padding: "10px 16px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none",
                        cursor: "pointer", alignItems: "center",
                        background: selectedId === p.id ? "var(--surface-raised)" : "transparent",
                        transition: "background 0.1s ease",
                      }}
                    >
                      <div style={{ paddingRight: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 340 }}>{p.name}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{p.sku}</span>
                          <span style={{ fontSize: 10, color: "var(--border)" }}>·</span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{p.subCategory.split(" > ").pop()}</span>
                        </div>
                      </div>
                      <div><SourceTag source={p.sourceSystem} /></div>
                      <div><StatusBadge status={p.status} /></div>
                      <div><ReadinessBar score={p.readinessScore} /></div>
                      <div><ChannelDots channels={p.channels} /></div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(p.lastModified).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <div>
                        <ChevronRight size={12} color="var(--text-muted)" style={{ transform: selectedId === p.id ? "rotate(90deg)" : "none", transition: "transform 0.2s ease" }} />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {filtered.length === 0 && (
                  <div style={{ padding: 32, textAlign: "center" as const, color: "var(--text-muted)", fontSize: 12 }}>No products match.</div>
                )}
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {selected && (
                  <motion.div key={selected.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginTop: 1, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-raised)" }}>
                    <div style={{ padding: "16px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{selected.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>GTIN: {selected.gtin} · Brand: {selected.brand}</div>
                        </div>
                        <Link to="/readiness" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, background: "var(--mirchi)", color: "white", fontSize: 11, fontWeight: 600 }}>
                          Check Readiness <ArrowUpRight size={11} />
                        </Link>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {Object.values(selected.attributes).map(attr => (
                          <div key={attr.name} style={{ padding: "10px 12px", borderRadius: 6, border: `1px solid ${attr.issues?.length ? "var(--red)" : "var(--border-subtle)"}`, background: attr.issues?.length ? "var(--red-dim)" : "var(--surface)" }}>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{attr.name}</div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: attr.value !== null ? "var(--text-primary)" : "var(--text-muted)" }}>
                              {attr.value !== null ? `${attr.value}${attr.unit ? " " + attr.unit : ""}` : "— not set —"}
                            </div>
                            {attr.issues?.map((issue, j) => (
                              <div key={j} style={{ fontSize: 10, color: "var(--red)", marginTop: 4, display: "flex", alignItems: "flex-start", gap: 4 }}>
                                <AlertTriangle size={9} style={{ marginTop: 1, flexShrink: 0 }} />
                                {issue.message}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                        {selected.images.map((img, j) => (
                          <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 6, border: `1px solid ${img.compliant ? "var(--border-subtle)" : "var(--red)"}`, background: img.compliant ? "var(--surface)" : "var(--red-dim)", fontSize: 11, color: img.compliant ? "var(--text-secondary)" : "var(--red)" }}>
                            {img.compliant ? <CheckCircle2 size={11} color="var(--green)" /> : <ImageOff size={11} />}
                            {img.type} · {img.width}×{img.height} · {img.sizeKb}kb{!img.compliant && " · Non-compliant"}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Footer CTA */}
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--surface)" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>6 products imported · {CATALOG_STATS.attributeIssues} attribute issues detected</div>
                <Link to="/readiness" style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 6, background: "var(--mirchi)", color: "white", fontSize: 12, fontWeight: 600 }}>
                  Continue to Retailer Readiness <ChevronRight size={13} />
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
