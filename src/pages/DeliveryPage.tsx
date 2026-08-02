import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/shell/AppShell";
import { RETAILERS } from "../lib/seed-data";
import { HISTORY, SCHEMAS, FORMATS, shippable, toCsv, toJson, type FormatId } from "../lib/delivery-data";
import {
  Send, Table, Braces, Sheet, Package, Cloud, Check, X, ArrowRight,
  Loader2, FileDown, Clock, AlertTriangle, CheckCircle2, Copy,
} from "lucide-react";

const ICONS = { table: Table, braces: Braces, sheet: Sheet, package: Package, cloud: Cloud };

const STATUS_META = {
  accepted: { color: "var(--green)", bg: "var(--green-dim)", label: "Accepted", Icon: CheckCircle2 },
  partial: { color: "var(--amber)", bg: "var(--amber-dim)", label: "Partial", Icon: AlertTriangle },
  rejected: { color: "var(--red)", bg: "var(--red-dim)", label: "Rejected", Icon: X },
  processing: { color: "var(--blue)", bg: "var(--surface-overlay)", label: "Processing", Icon: Clock },
};

type Phase = "idle" | "building" | "validating" | "packaging" | "done";

const PHASE_LABEL: Record<Exclude<Phase, "idle" | "done">, string> = {
  building: "Applying mapping rules…",
  validating: "Running retailer schema validation…",
  packaging: "Packaging payload…",
};

export function DeliveryPage() {
  const [retailerId, setRetailerId] = useState("walmart");
  const [format, setFormat] = useState<FormatId>("csv");
  const [phase, setPhase] = useState<Phase>("idle");
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const retailer = RETAILERS.find(r => r.id === retailerId)!;
  const rows = useMemo(() => shippable(retailerId), [retailerId]);
  const ready = rows.filter(r => r.ready);
  const blocked = rows.filter(r => !r.ready);
  const outgoing = includeBlocked ? rows : ready;

  const payload = useMemo(() => {
    const recs = outgoing.map(r => r.record);
    if (format === "json" || format === "api") return toJson(recs);
    return toCsv(retailerId, recs);
  }, [outgoing, format, retailerId]);

  const fmt = FORMATS.find(f => f.id === format)!;
  const fileName = format === "api"
    ? `POST /vendor/v3/items`
    : `${retailerId}_catalog_2026-08-01.${fmt.ext}`;
  const sizeKb = Math.max(1, Math.round(payload.length / 1024 * 10) / 10);

  // Run the generate sequence
  useEffect(() => {
    if (phase === "idle" || phase === "done") return;
    const next: Record<string, Phase> = { building: "validating", validating: "packaging", packaging: "done" };
    const t = setTimeout(() => setPhase(next[phase]), 700);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => { setPhase("idle"); }, [retailerId, format, includeBlocked]);

  const copy = () => {
    navigator.clipboard?.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <Send size={15} color="var(--mirchi)" strokeWidth={2} />
              <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Delivery</h1>
              <span style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", background: "var(--surface-overlay)", borderRadius: 4 }}>Step 5 of 6</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              Generate the {retailer.name} payload in their required format — or push it straight to their endpoint.
            </p>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {RETAILERS.map(r => {
              const active = r.id === retailerId;
              const n = shippable(r.id).filter(x => x.ready).length;
              return (
                <button key={r.id} onClick={() => setRetailerId(r.id)} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 13px",
                  background: "transparent", border: "none",
                  borderBottom: `2px solid ${active ? "var(--mirchi)" : "transparent"}`,
                  color: active ? "var(--mirchi)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer", transition: "all 0.12s ease",
                }}>
                  {r.name}
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: n > 0 ? "var(--green-dim)" : "var(--surface-overlay)", color: n > 0 ? "var(--green)" : "var(--text-muted)" }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main split */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", minHeight: 0 }}>

          {/* Left: config */}
          <div style={{ borderRight: "1px solid var(--border)", padding: "16px 16px 20px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Format */}
            <div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>Output Format</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {FORMATS.map(f => {
                  const Icon = ICONS[f.icon];
                  const active = f.id === format;
                  return (
                    <button key={f.id} onClick={() => setFormat(f.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 7,
                      background: active ? "var(--mirchi-dim)" : "var(--surface)",
                      border: `1px solid ${active ? "var(--mirchi-glow)" : "var(--border)"}`,
                      cursor: "pointer", textAlign: "left", transition: "all 0.12s ease",
                    }}>
                      <Icon size={14} color={active ? "var(--mirchi)" : "var(--text-muted)"} strokeWidth={2} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: active ? 600 : 500, color: active ? "var(--mirchi)" : "var(--text-primary)" }}>{f.label}</div>
                        <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 1 }}>{f.desc}</div>
                      </div>
                      {active && <Check size={12} color="var(--mirchi)" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scope */}
            <div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>Scope</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 11px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Schema-complete SKUs</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{ready.length}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 11px", background: blocked.length ? "var(--red-dim)" : "var(--surface)", border: `1px solid ${blocked.length ? "rgba(239,91,78,0.18)" : "var(--border)"}`, borderRadius: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Missing required fields</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: blocked.length ? "var(--red)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{blocked.length}</span>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", cursor: "pointer" }}>
                  <input type="checkbox" checked={includeBlocked} onChange={e => setIncludeBlocked(e.target.checked)} style={{ accentColor: "var(--mirchi)", cursor: "pointer" }} />
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Include incomplete SKUs (retailer will reject)</span>
                </label>
              </div>
            </div>

            {/* Blocked list */}
            {blocked.length > 0 && (
              <div>
                <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>Held Back</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {blocked.map(b => (
                    <div key={b.product.id} style={{ padding: "7px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
                      <div style={{ fontSize: 10.5, color: "var(--text-primary)", fontFamily: "ui-monospace, monospace", marginBottom: 3 }}>{b.product.sku}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {b.missing.map(m => (
                          <span key={m} style={{ fontSize: 9, fontFamily: "ui-monospace, monospace", padding: "1px 5px", borderRadius: 3, background: "var(--red-dim)", color: "var(--red)" }}>{m}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generate */}
            <div style={{ marginTop: "auto" }}>
              <button
                onClick={() => setPhase("building")}
                disabled={phase !== "idle" && phase !== "done"}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "10px 14px", borderRadius: 7, border: "none",
                  background: phase === "done" ? "var(--green)" : "var(--mirchi)",
                  color: "white", fontSize: 12.5, fontWeight: 600,
                  cursor: phase === "idle" || phase === "done" ? "pointer" : "default",
                  opacity: phase !== "idle" && phase !== "done" ? 0.75 : 1,
                  transition: "background 0.2s ease",
                }}
              >
                {phase === "idle" && <><Send size={13} /> {format === "api" ? `Push to ${retailer.name} API` : "Generate & Deliver"}</>}
                {phase !== "idle" && phase !== "done" && <><Loader2 size={13} className="dk-spin" /> {PHASE_LABEL[phase]}</>}
                {phase === "done" && <><Check size={14} strokeWidth={3} /> Delivered to {retailer.name}</>}
              </button>

              <AnimatePresence>
                {phase === "done" && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{ marginTop: 8, padding: "9px 11px", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <FileDown size={11} color="var(--green)" />
                      <span style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)" }}>{fileName}</span>
                    </div>
                    <div style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
                      {outgoing.length} SKUs · {sizeKb} KB · {SCHEMAS[retailerId].columns.length} fields per record
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right: preview + history */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>

            {/* Preview header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)" }}>Payload Preview</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>{fileName}</span>
              </div>
              <button onClick={copy} style={{
                display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 5,
                background: "var(--surface-overlay)", border: "1px solid var(--border)",
                color: copied ? "var(--green)" : "var(--text-secondary)", fontSize: 10.5, fontWeight: 600, cursor: "pointer",
              }}>
                {copied ? <><Check size={10} strokeWidth={3} /> Copied</> : <><Copy size={10} /> Copy</>}
              </button>
            </div>

            {/* Preview body */}
            <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
              <pre style={{
                margin: 0, padding: "12px 14px", background: "var(--surface)",
                border: "1px solid var(--border)", borderRadius: 7,
                fontSize: 10.5, lineHeight: 1.6, fontFamily: "ui-monospace, monospace",
                color: "var(--text-secondary)", overflowX: "auto", maxHeight: 250,
                whiteSpace: "pre",
              }}>{payload}</pre>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 7 }}>
                {format === "json" || format === "api"
                  ? `Showing first 2 of ${outgoing.length} records`
                  : `${outgoing.length} rows · ${SCHEMAS[retailerId].columns.length} columns · generated live from approved mappings`}
              </div>
            </div>

            {/* History */}
            <div style={{ flex: 1, padding: "14px 16px 20px" }}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 9 }}>Delivery History</div>

              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px 60px 96px 110px", gap: 10, padding: "0 10px 6px", borderBottom: "1px solid var(--border-subtle)" }}>
                {["Retailer", "File", "Format", "SKUs", "Status", "Delivered"].map(h => (
                  <div key={h} style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>

              {HISTORY.map(h => {
                const sm = STATUS_META[h.status];
                return (
                  <div key={h.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 130px 60px 96px 110px", gap: 10, padding: "9px 10px", borderBottom: "1px solid var(--border-subtle)", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{h.retailer}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.fileName}</div>
                      {h.note && <div style={{ fontSize: 9.5, color: sm.color, marginTop: 1 }}>{h.note}</div>}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{h.format}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{h.skuCount}</div>
                    <div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: sm.bg, color: sm.color }}>
                        <sm.Icon size={9} /> {sm.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {new Date(h.deliveredAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {h.deliveredBy === "Automated" ? "auto" : h.deliveredBy.split(" ")[0]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "11px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--green)", fontWeight: 600 }}>{ready.length} of {rows.length} SKUs</span> clear the {retailer.name} schema
            {blocked.length > 0 && <> · <span style={{ color: "var(--red)", fontWeight: 600 }}>{blocked.length} held back</span></>}
          </div>
          <a href="/feedback" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--mirchi)", borderRadius: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "white" }}>Monitor Retail Feedback</span>
              <ArrowRight size={12} color="white" />
            </div>
          </a>
        </div>
      </div>
    </AppShell>
  );
}
