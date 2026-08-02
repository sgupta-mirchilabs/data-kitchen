import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Database, FileText, GitBranch, Clock } from "lucide-react";
import type { CatalogProduct, CatalogRepository, SourceRecord, ProvenanceRecord, HistoryRecord } from "../../lib/catalog-repository";

interface Props {
  product: CatalogProduct;
  repo: CatalogRepository;
  onClose: () => void;
}

type Tab = "canonical" | "source" | "provenance" | "history";

export function ProductDetail({ product, repo, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("canonical");
  const [sourceRecords, setSourceRecords] = useState<SourceRecord[]>([]);
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    if (tab === "source") repo.getSourceRecords(product.id).then(setSourceRecords);
    if (tab === "provenance") repo.getProvenance(product.id).then(setProvenance);
    if (tab === "history") repo.getHistory(product.id).then(setHistory);
  }, [tab, product.id, repo]);

  const tabs: { key: Tab; label: string; icon: typeof Database }[] = [
    { key: "canonical", label: "Canonical Record", icon: Database },
    { key: "source", label: "Original Source", icon: FileText },
    { key: "provenance", label: "Field Provenance", icon: GitBranch },
    { key: "history", label: "Change History", icon: Clock },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        overflow: "hidden", marginTop: 1, border: "1px solid var(--border)",
        borderRadius: 8, background: "var(--surface-raised)",
      }}
    >
      <div style={{ padding: "16px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              {product.productName ?? "Unnamed Product"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              SKU: {product.sku ?? "—"} · GTIN: {product.gtin ?? "—"} · Brand: {product.brand ?? "—"}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 24, height: 24, borderRadius: 4, border: "1px solid var(--border)",
            background: "transparent", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: "var(--text-muted)",
          }}>
            <X size={12} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 8 }}>
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 5, border: "1px solid",
                borderColor: tab === key ? "var(--mirchi-glow)" : "transparent",
                background: tab === key ? "var(--mirchi-dim)" : "transparent",
                color: tab === key ? "var(--mirchi)" : "var(--text-muted)",
                fontSize: 11, fontWeight: tab === key ? 600 : 400, cursor: "pointer",
              }}
            >
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "canonical" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              { label: "SKU", value: product.sku },
              { label: "GTIN", value: product.gtin },
              { label: "Brand", value: product.brand },
              { label: "Product Name", value: product.productName },
              { label: "Category", value: product.category },
              { label: "Lifecycle", value: product.lifecycleStatus },
              { label: "Data Quality", value: product.dataQualityStatus },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--surface)" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {value ?? "— not set —"}
                </div>
              </div>
            ))}
            {Object.entries(product.attributes as Record<string, unknown>).map(([key, value]) => (
              <div key={key} style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--surface)" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>{key}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "source" && (
          <div>
            {sourceRecords.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                {repo.mode === "demo" ? "Source records are not available in demo mode" : "No source records found"}
              </div>
            ) : (
              sourceRecords.map((sr) => (
                <div key={sr.id} style={{ marginBottom: 12, borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
                  <div style={{ padding: "8px 12px", background: "var(--surface-raised)", fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>Row {sr.rowNumber} · {sr.importBatch?.filename ?? "Unknown file"}</span>
                    <span>{sr.parseStatus}</span>
                  </div>
                  <div style={{ padding: 12, fontSize: 11, fontFamily: "monospace", overflowX: "auto", maxHeight: 200 }}>
                    <pre style={{ margin: 0, color: "var(--text-secondary)" }}>
                      {JSON.stringify(sr.rawPayloadJson, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "provenance" && (
          <div>
            {provenance.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                {repo.mode === "demo" ? "Provenance is not available in demo mode" : "No provenance records found"}
              </div>
            ) : (
              <div style={{ borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 120px", padding: "8px 12px", background: "var(--surface-raised)", borderBottom: "1px solid var(--border)" }}>
                  {["Canonical Field", "Source Field", "Original Value", "Normalized Value", "Method"].map((h) => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</div>
                  ))}
                </div>
                {provenance.map((p) => (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 120px", padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)", fontSize: 11 }}>
                    <div style={{ color: "var(--mirchi)", fontWeight: 500 }}>{p.canonicalField}</div>
                    <div style={{ color: "var(--text-secondary)" }}>{p.sourceField}</div>
                    <div style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 10 }}>{p.originalValue ?? "—"}</div>
                    <div style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: 10 }}>{p.normalizedValue ?? "—"}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{p.normalizationMethod ?? "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div>
            {history.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                {repo.mode === "demo" ? "Change history is not available in demo mode" : "No changes recorded"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {history.map((h) => (
                  <div key={h.id} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--surface)", fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "var(--mirchi)", fontWeight: 500 }}>{h.field}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                        {new Date(h.createdAt).toLocaleDateString()} · {h.actor ?? "system"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--red)", fontFamily: "monospace", fontSize: 10 }}>
                        {h.previousValue ?? "null"}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>→</span>
                      <span style={{ color: "var(--green)", fontFamily: "monospace", fontSize: 10 }}>
                        {h.newValue ?? "null"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
