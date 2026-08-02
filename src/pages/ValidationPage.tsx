import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/shell/AppShell";
import { ALL_EXCEPTIONS, DETECTED_META, TEAM, type EnrichedException } from "../lib/validation-data";
import {
  AlertTriangle, Sparkles, Check, X, ChevronDown, ChevronRight, Search,
  Zap, FileText, ArrowRight, DollarSign, UserPlus, ShieldAlert, Image as ImageIcon,
} from "lucide-react";

type Decision = "approved" | "dismissed";

const money = (n: number) => `$${n.toLocaleString()}`;

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: "error" | "warning" }) {
  const c = severity === "error" ? "var(--red)" : "var(--amber)";
  return <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}60`, flexShrink: 0 }} />;
}

function ConfidenceBadge({ value }: { value: number }) {
  if (value === 0) {
    return <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>No auto-fix</span>;
  }
  const color = value >= 95 ? "var(--green)" : value >= 85 ? "var(--blue)" : value >= 75 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Sparkles size={10} color={color} />
      <span style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}%</span>
    </div>
  );
}

function TypeIcon({ e }: { e: EnrichedException }) {
  const size = 12;
  if (e.errorType === "compliance") return <ShieldAlert size={size} color="var(--red)" />;
  if (e.errorType === "image_issue") return <ImageIcon size={size} color="var(--purple)" />;
  return <AlertTriangle size={size} color={e.severity === "error" ? "var(--red)" : "var(--amber)"} />;
}

const GRID = "18px 1fr 88px 130px 96px 96px 150px 22px";

function ExceptionRow({ e, decision, expanded, onToggle, onApprove, onDismiss, assignee, onAssign }: {
  e: EnrichedException; decision?: Decision; expanded: boolean;
  onToggle: () => void; onApprove: () => void; onDismiss: () => void;
  assignee?: string; onAssign: (who: string) => void;
}) {
  const dm = DETECTED_META[e.detectedBy];
  const settled = decision !== undefined;

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center",
          padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
          background: expanded ? "var(--surface-raised)" : "transparent",
          opacity: decision === "dismissed" ? 0.42 : 1,
          transition: "background 0.12s ease, opacity 0.2s ease",
        }}
      >
        <SeverityDot severity={e.severity} />

        {/* Product + field */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <TypeIcon e={e} />
            <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)" }}>{e.field}</span>
            <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>{e.errorCode}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {e.productName} · {e.sku}
          </div>
        </div>

        {/* Channel */}
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{e.channel}</div>

        {/* Detected by */}
        <div>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, color: dm.color, background: "var(--surface-overlay)", border: `1px solid ${dm.color}25`, whiteSpace: "nowrap" }}>
            {dm.label}
          </span>
        </div>

        {/* Revenue */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: e.severity === "error" ? "var(--red)" : "var(--amber)", fontVariantNumeric: "tabular-nums" }}>
          {money(e.revenueUsd)}<span style={{ fontSize: 9, fontWeight: 400, color: "var(--text-muted)" }}>/mo</span>
        </div>

        {/* Confidence */}
        <div><ConfidenceBadge value={e.aiConfidence} /></div>

        {/* Actions */}
        <div onClick={ev => ev.stopPropagation()}>
          {settled ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {decision === "approved" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "var(--green)", padding: "2px 8px", borderRadius: 10, background: "var(--green-dim)" }}>
                  <Check size={10} strokeWidth={3} /> Fix applied
                </span>
              ) : (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 10, background: "var(--surface-overlay)" }}>Dismissed</span>
              )}
            </div>
          ) : e.aiConfidence === 0 ? (
            <select
              value={assignee ?? ""}
              onChange={ev => onAssign(ev.target.value)}
              style={{
                fontSize: 10.5, padding: "4px 7px", borderRadius: 5,
                background: "var(--surface-overlay)", border: "1px solid var(--border)",
                color: assignee ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", maxWidth: 145,
              }}
            >
              <option value="">Assign to…</option>
              {TEAM.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={onApprove} style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 5,
                background: "var(--green-dim)", border: "1px solid rgba(34,197,94,0.25)",
                color: "var(--green)", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              }}><Check size={10} strokeWidth={3} /> Apply fix</button>
              <button onClick={onDismiss} style={{
                display: "flex", alignItems: "center", padding: "3px 7px", borderRadius: 5,
                background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer",
              }}><X size={10} strokeWidth={3} /></button>
            </div>
          )}
        </div>

        <div style={{ color: "var(--text-muted)", display: "flex", justifyContent: "center" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {/* Expanded */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }} style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "12px 16px 16px 44px", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                {/* Current */}
                <div style={{ background: "var(--red-dim)", border: "1px solid rgba(239,91,78,0.18)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ fontSize: 9.5, color: "var(--red)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>Current Value</div>
                  <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: e.currentValue ? "var(--text-secondary)" : "var(--red)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {e.currentValue ?? "— missing —"}
                  </div>
                </div>

                {/* Proposed */}
                <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                    <Sparkles size={10} color="var(--green)" />
                    <span style={{ fontSize: 9.5, color: "var(--green)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {e.aiConfidence === 0 ? "Recommended Action" : "AI-Proposed Fix"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {e.proposedFix}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", fontSize: 10.5, color: "var(--text-muted)" }}>
                {e.sourceDocument && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <FileText size={11} color="var(--blue)" />
                    Extracted from <span style={{ color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>{e.sourceDocument}</span>
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <DollarSign size={11} color={e.severity === "error" ? "var(--red)" : "var(--amber)"} />
                  {e.revenueImpact}
                </span>
                {(assignee ?? e.assignedTo) && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <UserPlus size={11} />
                    Assigned to <span style={{ color: "var(--text-secondary)" }}>{assignee ?? e.assignedTo}</span>
                  </span>
                )}
                <span>Detected {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ValidationPage() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sev, setSev] = useState<"all" | "error" | "warning">("all");
  const [chan, setChan] = useState("all");

  const channels = ["all", ...Array.from(new Set(ALL_EXCEPTIONS.map(e => e.channel)))];

  const open = ALL_EXCEPTIONS.filter(e => !decisions[e.id]);
  const fixed = ALL_EXCEPTIONS.filter(e => decisions[e.id] === "approved");
  const errors = open.filter(e => e.severity === "error").length;
  const warnings = open.filter(e => e.severity === "warning").length;
  const atRisk = open.reduce((s, e) => s + e.revenueUsd, 0);
  const recovered = fixed.reduce((s, e) => s + e.revenueUsd, 0);
  const autoFixable = open.filter(e => e.aiConfidence >= 85).length;
  const needsHuman = open.filter(e => e.aiConfidence === 0).length;

  const visible = ALL_EXCEPTIONS.filter(e => {
    if (sev !== "all" && e.severity !== sev) return false;
    if (chan !== "all" && e.channel !== chan) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return e.field.toLowerCase().includes(q) || e.productName.toLowerCase().includes(q)
      || e.sku.toLowerCase().includes(q) || e.errorCode.toLowerCase().includes(q);
  }).sort((a, b) => {
    const da = decisions[a.id] ? 1 : 0, db = decisions[b.id] ? 1 : 0;
    if (da !== db) return da - db;
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return b.revenueUsd - a.revenueUsd;
  });

  const bulk = open.filter(e => e.aiConfidence >= 85);
  const healAll = () => setDecisions(p => {
    const next = { ...p };
    bulk.forEach(e => { next[e.id] = "approved"; });
    return next;
  });

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <AlertTriangle size={15} color="var(--mirchi)" strokeWidth={2} />
              <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Validation &amp; Exceptions</h1>
              <span style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", background: "var(--surface-overlay)", borderRadius: 4 }}>Step 4 of 6</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              Every blocker between your catalog and a live listing. AI proposes the fix — you decide what ships.
            </p>
          </div>

          {bulk.length > 0 && (
            <button onClick={healAll} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 6,
              background: "var(--mirchi)", border: "none", color: "white", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            }}>
              <Zap size={12} strokeWidth={2.5} /> Auto-heal {bulk.length} at 85%+
            </button>
          )}
        </div>

        {/* Stats */}
        <motion.div
          key={`${errors}-${warnings}-${atRisk}`}
          initial={{ opacity: 0.65 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
        >
          {[
            { label: "Revenue at Risk", value: money(atRisk), color: atRisk > 0 ? "var(--red)" : "var(--green)", note: "Monthly, across open issues" },
            { label: "Recovered", value: money(recovered), color: "var(--green)", note: `${fixed.length} fix${fixed.length === 1 ? "" : "es"} applied` },
            { label: "Errors", value: String(errors), color: errors > 0 ? "var(--red)" : "var(--green)", note: "Hard blockers" },
            { label: "Warnings", value: String(warnings), color: "var(--amber)", note: "Quality issues" },
            { label: "Auto-Fixable", value: String(autoFixable), color: "var(--purple)", note: "AI confidence ≥ 85%" },
            { label: "Needs a Human", value: String(needsHuman), color: "var(--blue)", note: "No AI fix available" },
          ].map(s => (
            <div key={s.label} style={{ padding: "13px 18px", borderRight: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>{s.note}</div>
            </div>
          ))}
        </motion.div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 320 }}>
            <Search size={12} color="var(--text-muted)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search field, SKU, or error code…"
              style={{
                width: "100%", padding: "6px 10px 6px 28px", fontSize: 11.5,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", outline: "none",
              }}
            />
          </div>

          {(["all", "error", "warning"] as const).map(s => (
            <button key={s} onClick={() => setSev(s)} style={{
              padding: "5px 11px", fontSize: 11, borderRadius: 6, cursor: "pointer", textTransform: "capitalize",
              background: sev === s ? "var(--mirchi-dim)" : "transparent",
              border: `1px solid ${sev === s ? "var(--mirchi-glow)" : "var(--border)"}`,
              color: sev === s ? "var(--mirchi)" : "var(--text-secondary)", fontWeight: sev === s ? 600 : 400,
            }}>{s === "all" ? "All severities" : s + "s"}</button>
          ))}

          <select value={chan} onChange={e => setChan(e.target.value)} style={{
            fontSize: 11, padding: "5px 9px", borderRadius: 6,
            background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer",
          }}>
            {channels.map(c => <option key={c} value={c}>{c === "all" ? "All channels" : c}</option>)}
          </select>
        </div>

        {/* Column header */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          {["", "Field / Product", "Channel", "Detected By", "Impact", "AI Fix", "Action", ""].map((h, i) => (
            <div key={i} style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1 }}>
          {visible.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
              No exceptions match this filter.
            </div>
          ) : visible.map(e => (
            <ExceptionRow
              key={e.id}
              e={e}
              decision={decisions[e.id]}
              expanded={expandedId === e.id}
              onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
              onApprove={() => setDecisions(p => ({ ...p, [e.id]: "approved" }))}
              onDismiss={() => setDecisions(p => ({ ...p, [e.id]: "dismissed" }))}
              assignee={assignments[e.id] ?? e.assignedTo}
              onAssign={who => setAssignments(p => ({ ...p, [e.id]: who }))}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "11px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", position: "sticky", bottom: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {open.length > 0 ? (
              <><span style={{ color: "var(--red)", fontWeight: 600 }}>{open.length} open</span> · <span style={{ color: "var(--green)", fontWeight: 600 }}>{money(recovered)}/mo recovered</span> so far</>
            ) : (
              <span style={{ color: "var(--green)", fontWeight: 600 }}>All exceptions resolved — {money(recovered)}/mo recovered. Catalog is delivery-ready.</span>
            )}
          </div>
          <a href="/delivery" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--mirchi)", borderRadius: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "white" }}>Continue to Delivery</span>
              <ArrowRight size={12} color="white" />
            </div>
          </a>
        </div>
      </div>
    </AppShell>
  );
}
