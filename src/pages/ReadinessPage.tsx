import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/shell/AppShell";
import { PRODUCTS, RETAILERS, type Product, type Retailer } from "../lib/seed-data";
import { ShoppingBag, ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertCircle, ArrowRight, TrendingUp } from "lucide-react";

// ─── Per-retailer readiness logic ────────────────────────────────────────────

type FieldStatus = "pass" | "fail" | "warn" | "na";

interface FieldCheck {
  field: string;
  label: string;
  status: FieldStatus;
  currentValue: string | null;
  note?: string;
}

interface ProductReadiness {
  product: Product;
  score: number;
  passCount: number;
  failCount: number;
  warnCount: number;
  fieldChecks: FieldCheck[];
  channelStatus: "live" | "rejected" | "pending" | "not_submitted";
}

function getChannelStatus(product: Product, retailerId: string): "live" | "rejected" | "pending" | "not_submitted" {
  const channelMap: Record<string, string> = {
    walmart: "Walmart", target: "Target", homedepot: "Home Depot",
    amazon: "Amazon", costco: "Costco",
  };
  const name = channelMap[retailerId];
  const ch = product.channels.find(c => c.channel === name);
  return ch?.status ?? "not_submitted";
}

function computeReadiness(product: Product, retailer: Retailer): ProductReadiness {
  const checks: FieldCheck[] = [];

  if (retailer.id === "walmart") {
    const titleVal = product.attributes.title?.value as string;
    checks.push(
      { field: "gtin", label: "GTIN / UPC", status: product.gtin ? "pass" : "fail", currentValue: product.gtin || null },
      { field: "title", label: "Title (≤200 chars)", status: titleVal && titleVal.length > 200 ? "fail" : titleVal ? "pass" : "fail", currentValue: titleVal || null, note: titleVal && titleVal.length > 200 ? `${titleVal.length} chars (limit 200)` : undefined },
      { field: "brand", label: "Brand", status: product.attributes.brand?.value ? "pass" : "fail", currentValue: product.attributes.brand?.value as string | null },
      { field: "category", label: "Category", status: product.category ? "pass" : "fail", currentValue: product.category },
      { field: "short_description", label: "Short Description", status: titleVal ? "warn" : "fail", currentValue: null, note: "Derived from title — review recommended" },
      { field: "weight", label: "Weight (oz)", status: product.attributes.weight?.value != null ? "pass" : "fail", currentValue: product.attributes.weight?.value != null ? `${product.attributes.weight.value} ${product.attributes.weight.unit}` : null },
      { field: "images_hero", label: "Hero Image (2000×2000)", status: (() => { const img = product.images.find(i => i.type === "hero"); return img && img.compliant ? "pass" : img ? "warn" : "fail"; })(), currentValue: null, note: (() => { const img = product.images.find(i => i.type === "hero"); return img && !img.compliant ? "Image dimensions non-compliant" : undefined; })() },
      { field: "country_of_origin", label: "Country of Origin", status: product.attributes.country_of_origin?.value ? "pass" : "fail", currentValue: product.attributes.country_of_origin?.value as string | null },
    );
  }

  if (retailer.id === "target") {
    checks.push(
      { field: "tcin", label: "TCIN / GTIN", status: product.gtin ? "pass" : "fail", currentValue: product.gtin || null },
      { field: "title", label: "Title", status: product.attributes.title?.value ? "pass" : "fail", currentValue: product.attributes.title?.value as string | null },
      { field: "brand", label: "Brand", status: product.attributes.brand?.value ? "pass" : "fail", currentValue: product.attributes.brand?.value as string | null },
      { field: "bullet_1", label: "Bullet Point 1", status: "fail", currentValue: null, note: "No bullet points in source PIM" },
      { field: "bullet_2", label: "Bullet Point 2", status: "fail", currentValue: null, note: "No bullet points in source PIM" },
      { field: "bullet_3", label: "Bullet Point 3", status: "fail", currentValue: null, note: "No bullet points in source PIM" },
      { field: "material", label: "Material Composition", status: product.attributes.material?.value ? "pass" : "warn", currentValue: product.attributes.material?.value as string | null, note: product.attributes.material?.value ? undefined : "Not in source — enrichment needed" },
      { field: "care_instructions", label: "Care Instructions", status: product.category === "Apparel" ? "fail" : "na", currentValue: null, note: product.category === "Apparel" ? "Required for Apparel — not found in PIM" : undefined },
      { field: "country_of_origin", label: "Country of Origin", status: product.attributes.country_of_origin?.value ? "pass" : "fail", currentValue: product.attributes.country_of_origin?.value as string | null },
      { field: "waterproof", label: "Waterproof Rating", status: product.attributes.waterproof?.value != null ? "pass" : product.category === "Apparel" ? "fail" : "na", currentValue: product.attributes.waterproof?.value != null ? String(product.attributes.waterproof.value) : null, note: product.attributes.waterproof?.value == null && product.category === "Apparel" ? "Required for Apparel — missing" : undefined },
    );
  }

  if (retailer.id === "homedepot") {
    const titleVal = product.attributes.title?.value as string;
    checks.push(
      { field: "model_number", label: "Model Number", status: product.sku ? "warn" : "fail", currentValue: product.sku, note: "Using SKU as proxy — verify model number format" },
      { field: "manufacturer", label: "Manufacturer / Brand", status: product.attributes.brand?.value ? "pass" : "fail", currentValue: product.attributes.brand?.value as string | null },
      { field: "title", label: "Title (≤100 chars)", status: titleVal && titleVal.length > 100 ? "fail" : titleVal ? "pass" : "fail", currentValue: titleVal || null },
      { field: "description", label: "Full Description", status: "warn", currentValue: null, note: "Long description not populated in source" },
      { field: "specifications", label: "Specifications Table", status: Object.keys(product.attributes).length > 3 ? "warn" : "fail", currentValue: null, note: "Specs exist but need HD format mapping" },
      { field: "warranty", label: "Warranty Information", status: "fail", currentValue: null, note: "No warranty data in source PIM" },
      { field: "prop_65", label: "Prop 65 Warning", status: (() => { const p = product.attributes.prop_65; if (p?.value) return "pass"; if (p?.issues?.length) return "fail"; return "na"; })(), currentValue: product.attributes.prop_65?.value as string | null, note: product.attributes.prop_65?.issues?.[0]?.message },
      { field: "images_hero", label: "Hero Image (compliant)", status: (() => { const img = product.images.find(i => i.type === "hero"); return img && img.compliant ? "pass" : img ? "warn" : "fail"; })(), currentValue: null },
    );
  }

  if (retailer.id === "amazon") {
    const titleVal = product.attributes.title?.value as string;
    checks.push(
      { field: "asin", label: "ASIN / GTIN", status: product.gtin ? "pass" : "fail", currentValue: product.gtin || null },
      { field: "title", label: "Title (80–200 chars)", status: (() => { if (!titleVal) return "fail"; if (titleVal.length > 200) return "fail"; if (titleVal.length < 80) return "warn"; return "pass"; })(), currentValue: titleVal || null, note: (() => { if (!titleVal) return undefined; if (titleVal.length > 200) return `${titleVal.length} chars (limit 200)`; if (titleVal.length < 80) return `${titleVal.length} chars (min 80 preferred)`; return undefined; })() },
      { field: "brand", label: "Brand", status: product.attributes.brand?.value ? "pass" : "fail", currentValue: product.attributes.brand?.value as string | null },
      { field: "bullet_points", label: "Bullet Points (5)", status: "fail", currentValue: null, note: "No bullet points found in source" },
      { field: "search_terms", label: "Search Terms / Keywords", status: "fail", currentValue: null, note: "Requires AI enrichment" },
      { field: "product_type", label: "Product Type", status: product.subCategory ? "warn" : "fail", currentValue: product.subCategory, note: "Subcategory needs Amazon product_type mapping" },
      { field: "images", label: "Images (1 hero + 5 alt)", status: product.images.length >= 2 ? "warn" : "fail", currentValue: null, note: `${product.images.length} image(s) found — Amazon needs 6` },
      { field: "noise_cancellation", label: "Noise Cancellation Type", status: product.attributes.noise_cancellation?.value != null ? "pass" : product.category === "Electronics" ? "fail" : "na", currentValue: product.attributes.noise_cancellation?.value as string | null },
    );
  }

  if (retailer.id === "costco") {
    const titleVal = product.attributes.title?.value as string;
    checks.push(
      { field: "item_number", label: "Item Number / GTIN", status: product.gtin ? "pass" : "fail", currentValue: product.gtin || null },
      { field: "description", label: "Description (≤65 chars)", status: titleVal && titleVal.length > 65 ? "warn" : titleVal ? "pass" : "fail", currentValue: titleVal || null, note: titleVal && titleVal.length > 65 ? `${titleVal.length} chars — Costco limits to 65` : undefined },
      { field: "brand", label: "Brand", status: product.attributes.brand?.value ? "pass" : "fail", currentValue: product.attributes.brand?.value as string | null },
      { field: "country_of_origin", label: "Country of Origin", status: product.attributes.country_of_origin?.value ? "pass" : "fail", currentValue: product.attributes.country_of_origin?.value as string | null },
      { field: "unit_count", label: "Unit Count / Pack Size", status: "warn", currentValue: null, note: "Not present — Costco requires pack configuration" },
      { field: "net_weight", label: "Net Weight", status: product.attributes.weight?.value != null ? "pass" : "fail", currentValue: product.attributes.weight?.value != null ? `${product.attributes.weight.value} ${product.attributes.weight.unit}` : null },
      { field: "noise_db", label: "Noise Level (dB)", status: product.attributes.noise_db?.value != null ? "pass" : product.attributes.wattage?.value ? "warn" : "na", currentValue: product.attributes.noise_db?.value as string | null, note: product.attributes.wattage?.value && !product.attributes.noise_db?.value ? "Required for high-wattage appliances" : undefined },
    );
  }

  const pass = checks.filter(c => c.status === "pass").length;
  const fail = checks.filter(c => c.status === "fail").length;
  const warn = checks.filter(c => c.status === "warn").length;
  const total = checks.filter(c => c.status !== "na").length;
  const score = total > 0 ? Math.round((pass / total) * 100) : 0;

  return { product, score, passCount: pass, failCount: fail, warnCount: warn, fieldChecks: checks, channelStatus: getChannelStatus(product, retailer.id) };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RetailerCard({ retailer, selected, onClick, readiness }: {
  retailer: Retailer; selected: boolean; onClick: () => void; readiness: number;
}) {
  return (
    <button onClick={onClick} style={{
      background: selected ? "var(--mirchi-dim)" : "var(--surface)",
      border: `1px solid ${selected ? "var(--mirchi-glow)" : "var(--border)"}`,
      borderRadius: 8, padding: "12px 14px", cursor: "pointer",
      display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start",
      transition: "all 0.15s ease", minWidth: 110,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: selected ? "var(--mirchi)" : "var(--surface-overlay)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: selected ? "white" : "var(--text-muted)",
        }}>{retailer.logo}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: selected ? "var(--mirchi)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{readiness}%</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: selected ? 600 : 400, color: selected ? "var(--mirchi)" : "var(--text-secondary)" }}>{retailer.name}</div>
      <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{retailer.totalRequirements} fields</div>
    </button>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "var(--green)" : score >= 60 ? "var(--amber)" : "var(--red)";
  return (
    <svg width={72} height={72}>
      <circle cx={36} cy={36} r={r} fill="none" stroke="var(--border)" strokeWidth={5} transform="rotate(-90 36 36)" />
      <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
      <text x={36} y={40} textAnchor="middle" style={{ fill: color, fontSize: 14, fontWeight: 700 }}>{score}%</text>
    </svg>
  );
}

function StatusIcon({ status }: { status: FieldStatus }) {
  if (status === "pass") return <CheckCircle2 size={14} color="var(--green)" />;
  if (status === "fail") return <XCircle size={14} color="var(--red)" />;
  if (status === "warn") return <AlertCircle size={14} color="var(--amber)" />;
  return <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--border)", flexShrink: 0 }} />;
}

function ChannelStatusBadge({ status }: { status: "live" | "rejected" | "pending" | "not_submitted" }) {
  const config = {
    live: { bg: "var(--green-dim)", color: "var(--green)", label: "Live" },
    rejected: { bg: "var(--red-dim)", color: "var(--red)", label: "Rejected" },
    pending: { bg: "var(--amber-dim)", color: "var(--amber)", label: "Pending" },
    not_submitted: { bg: "var(--surface-overlay)", color: "var(--text-muted)", label: "Not Submitted" },
  }[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: config.bg, color: config.color }}>
      {config.label}
    </span>
  );
}

function MiniBar({ pass, warn, fail, total }: { pass: number; warn: number; fail: number; total: number }) {
  const pct = (n: number) => `${Math.max(4, Math.round((n / total) * 80))}px`;
  return (
    <div style={{ display: "flex", height: 4, borderRadius: 4, overflow: "hidden", gap: 1 }}>
      {pass > 0 && <div style={{ width: pct(pass), background: "var(--green)", borderRadius: 2, flexShrink: 0 }} />}
      {warn > 0 && <div style={{ width: pct(warn), background: "var(--amber)", borderRadius: 2, flexShrink: 0 }} />}
      {fail > 0 && <div style={{ width: pct(fail), background: "var(--red)", borderRadius: 2, flexShrink: 0 }} />}
    </div>
  );
}

function ProductRow({ pr, expanded, onToggle }: { pr: ProductReadiness; expanded: boolean; onToggle: () => void }) {
  const scoreColor = pr.score >= 80 ? "var(--green)" : pr.score >= 60 ? "var(--amber)" : "var(--red)";
  const total = pr.passCount + pr.warnCount + pr.failCount;
  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: "grid", gridTemplateColumns: "1fr 56px 88px 80px 90px 108px 24px",
          alignItems: "center", gap: 12, padding: "10px 16px",
          borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
          background: expanded ? "var(--surface-raised)" : "transparent",
          transition: "background 0.12s ease",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", marginBottom: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pr.product.name}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{pr.product.sku}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{pr.score}%</div>
        <MiniBar pass={pr.passCount} warn={pr.warnCount} fail={pr.failCount} total={total} />
        <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
          <span style={{ color: "var(--green)", fontWeight: 600 }}>✓{pr.passCount}</span>
          <span style={{ color: "var(--amber)", fontWeight: 600 }}>!{pr.warnCount}</span>
          <span style={{ color: "var(--red)", fontWeight: 600 }}>✗{pr.failCount}</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pr.product.category}</div>
        <ChannelStatusBadge status={pr.channelStatus} />
        <div style={{ color: "var(--text-muted)", display: "flex", justifyContent: "center" }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{
              padding: "12px 16px 16px",
              background: "var(--surface-raised)",
              borderBottom: "1px solid var(--border-subtle)",
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
                {pr.fieldChecks.map(fc => (
                  <div key={fc.field} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "7px 10px", borderRadius: 6,
                    background: fc.status === "fail" ? "var(--red-dim)" : fc.status === "warn" ? "rgba(245,158,11,0.06)" : "var(--surface-overlay)",
                    border: `1px solid ${fc.status === "fail" ? "rgba(239,91,78,0.15)" : fc.status === "warn" ? "rgba(245,158,11,0.12)" : "var(--border-subtle)"}`,
                  }}>
                    <div style={{ marginTop: 1, flexShrink: 0 }}><StatusIcon status={fc.status} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-primary)" }}>{fc.label}</div>
                      {fc.currentValue && (
                        <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fc.currentValue.length > 55 ? fc.currentValue.slice(0, 55) + "…" : fc.currentValue}
                        </div>
                      )}
                      {fc.note && (
                        <div style={{ fontSize: 10, color: fc.status === "fail" ? "var(--red)" : fc.status === "warn" ? "var(--amber)" : "var(--text-muted)", marginTop: 1 }}>
                          {fc.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReadinessPage() {
  const [selectedRetailerId, setSelectedRetailerId] = useState("walmart");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const retailer = RETAILERS.find(r => r.id === selectedRetailerId)!;
  const readinessList = PRODUCTS.map(p => computeReadiness(p, retailer));

  const avgByRetailer = (rid: string) => {
    const r = RETAILERS.find(x => x.id === rid)!;
    const list = PRODUCTS.map(p => computeReadiness(p, r));
    return Math.round(list.reduce((s, pr) => s + pr.score, 0) / list.length);
  };

  const overallScore = Math.round(readinessList.reduce((s, pr) => s + pr.score, 0) / readinessList.length);
  const totalPass = readinessList.reduce((s, pr) => s + pr.passCount, 0);
  const totalFail = readinessList.reduce((s, pr) => s + pr.failCount, 0);
  const totalWarn = readinessList.reduce((s, pr) => s + pr.warnCount, 0);
  const readyCount = readinessList.filter(pr => pr.score >= 80).length;

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <ShoppingBag size={15} color="var(--mirchi)" strokeWidth={2} />
                <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Retailer Readiness</h1>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                Select a retailer to score your catalog against their schema requirements.
              </p>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <TrendingUp size={11} color="var(--text-muted)" />
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Schema updated {retailer.lastSchemaUpdate}</span>
            </div>
          </div>

          {/* Retailer selector */}
          <div style={{ display: "flex", gap: 8, paddingBottom: 0, overflowX: "auto" }}>
            {RETAILERS.map(r => (
              <RetailerCard
                key={r.id}
                retailer={r}
                selected={r.id === selectedRetailerId}
                onClick={() => { setSelectedRetailerId(r.id); setExpandedId(null); }}
                readiness={avgByRetailer(r.id)}
              />
            ))}
          </div>
        </div>

        {/* Summary bar */}
        <motion.div
          key={selectedRetailerId}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, borderRight: "1px solid var(--border-subtle)" }}>
            <ScoreRing score={overallScore} />
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Avg Readiness</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: overallScore >= 80 ? "var(--green)" : overallScore >= 60 ? "var(--amber)" : "var(--red)", fontVariantNumeric: "tabular-nums" }}>{overallScore}%</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{retailer.name} schema</div>
            </div>
          </div>
          {[
            { label: "Products Ready", value: `${readyCount} / ${PRODUCTS.length}`, color: "var(--green)", note: "Score ≥ 80%" },
            { label: "Fields Passing", value: String(totalPass), color: "var(--green)", note: "Across all products" },
            { label: "Warnings", value: String(totalWarn), color: "var(--amber)", note: "Review recommended" },
            { label: "Fields Failing", value: String(totalFail), color: "var(--red)", note: "Action required" },
            { label: "Total Requirements", value: String(retailer.totalRequirements), color: "var(--text-primary)", note: `${retailer.categories.length} categories` },
          ].map(({ label, value, color, note }) => (
            <div key={label} style={{ padding: "16px 18px", borderRight: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{note}</div>
            </div>
          ))}
        </motion.div>

        {/* Table header */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 56px 88px 80px 90px 108px 24px",
          gap: 12, padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          {["Product", "Score", "Breakdown", "Fields", "Category", "Channel Status", ""].map(h => (
            <div key={h} style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>

        {/* Product rows */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedRetailerId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              {[...readinessList]
                .sort((a, b) => a.score - b.score)
                .map(pr => (
                  <ProductRow
                    key={pr.product.id}
                    pr={pr}
                    expanded={expandedId === pr.product.id}
                    onToggle={() => setExpandedId(expandedId === pr.product.id ? null : pr.product.id)}
                  />
                ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer CTA */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--red)", fontWeight: 600 }}>{totalFail}</span> failing fields across{" "}
            <span style={{ color: "var(--text-secondary)" }}>{PRODUCTS.length} products</span> need attention before {retailer.name} submission.
          </div>
          <a href="/mapping" style={{ textDecoration: "none" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
              background: "var(--mirchi)", borderRadius: 6, cursor: "pointer",
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "white" }}>Open Mapping Studio</span>
              <ArrowRight size={12} color="white" />
            </div>
          </a>
        </div>
      </div>
    </AppShell>
  );
}
