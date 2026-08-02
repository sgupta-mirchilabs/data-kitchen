import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/shell/AppShell";
import { RETAILERS } from "../lib/seed-data";
import { MAPPINGS, UNMAPPED, TRANSFORM_META, type Mapping, type MappingStatus } from "../lib/mapping-data";
import {
  GitMerge, ArrowRight, Sparkles, Check, X, ChevronDown, ChevronRight,
  Search, Zap, User, AlertTriangle, CornerDownRight, Database, Store,
} from "lucide-react";

// ─── Small pieces ─────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 95 ? "var(--green)" : value >= 85 ? "var(--blue)" : value >= 70 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 42, height: 3, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", minWidth: 24 }}>{value}%</span>
    </div>
  );
}

function TransformChip({ type }: { type: Mapping["transformType"] }) {
  const meta = TRANSFORM_META[type];
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
      padding: "2px 6px", borderRadius: 4, color: meta.color,
      background: "var(--surface-overlay)", border: `1px solid ${meta.color}25`, whiteSpace: "nowrap",
    }}>{meta.label}</span>
  );
}

function StatusPill({ status }: { status: MappingStatus }) {
  const cfg = {
    approved: { bg: "var(--green-dim)", color: "var(--green)", label: "Approved" },
    pending: { bg: "var(--amber-dim)", color: "var(--amber)", label: "Pending" },
    rejected: { bg: "var(--red-dim)", color: "var(--red)", label: "Rejected" },
  }[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: cfg.bg, color: cfg.color, whiteSpace: "nowrap" }}>
      {cfg.label}
    </span>
  );
}

function ByBadge({ by }: { by: "ai" | "human" }) {
  return by === "ai" ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--purple)", fontWeight: 600 }}>
      <Sparkles size={9} /> AI
    </span>
  ) : (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>
      <User size={9} /> Human
    </span>
  );
}

// ─── Mapping row ──────────────────────────────────────────────────────────────

const GRID = "260px 26px 250px 92px 62px 84px 108px 22px";

function MappingRow({ m, status, expanded, onToggle, onApprove, onReject }: {
  m: Mapping; status: MappingStatus; expanded: boolean;
  onToggle: () => void; onApprove: () => void; onReject: () => void;
}) {
  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: "grid", gridTemplateColumns: GRID, gap: 10,
          alignItems: "center", padding: "9px 16px",
          borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
          background: expanded ? "var(--surface-raised)" : "transparent",
          opacity: status === "rejected" ? 0.45 : 1,
          transition: "background 0.12s ease, opacity 0.2s ease",
        }}
      >
        {/* Source */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.sourceField}</div>
          <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 1 }}>{m.sourceSystem}</div>
        </div>

        {/* Arrow */}
        <div style={{ display: "flex", justifyContent: "center", color: status === "approved" ? "var(--green)" : "var(--text-muted)" }}>
          <ArrowRight size={13} strokeWidth={2} />
        </div>

        {/* Target */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.targetField}</span>
            {m.required && <span style={{ fontSize: 8, fontWeight: 700, color: "var(--red)", flexShrink: 0 }}>REQ</span>}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.targetLabel}</div>
        </div>

        <div><TransformChip type={m.transformType} /></div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{m.affects} SKU{m.affects === 1 ? "" : "s"}</div>
        <div><ConfidenceBar value={m.confidence} /></div>

        {/* Status / actions */}
        <div onClick={e => e.stopPropagation()}>
          {status === "pending" ? (
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={onApprove} title="Approve mapping" style={{
                display: "flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 5,
                background: "var(--green-dim)", border: "1px solid rgba(34,197,94,0.25)",
                color: "var(--green)", fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}><Check size={10} strokeWidth={3} /> Approve</button>
              <button onClick={onReject} title="Reject mapping" style={{
                display: "flex", alignItems: "center", padding: "3px 7px", borderRadius: 5,
                background: "transparent", border: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer",
              }}><X size={10} strokeWidth={3} /></button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusPill status={status} />
              <ByBadge by={m.mappedBy} />
            </div>
          )}
        </div>

        <div style={{ color: "var(--text-muted)", display: "flex", justifyContent: "center" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {/* Expanded — live transformation preview */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "12px 16px 16px 44px", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                Transformation Preview
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "stretch" }}>
                {/* Input */}
                <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                    <Database size={10} color="var(--text-muted)" />
                    <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em" }}>SOURCE · {m.sourceSystem}</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: m.sourceSample === "(empty)" ? "var(--red)" : "var(--text-secondary)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {m.sourceSample}
                  </div>
                </div>

                {/* Transform */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 150, maxWidth: 190, textAlign: "center" }}>
                  <TransformChip type={m.transformType} />
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.4 }}>{m.transformation}</div>
                  <ArrowRight size={14} color="var(--mirchi)" strokeWidth={2.5} />
                </div>

                {/* Output */}
                <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                    <Store size={10} color="var(--green)" />
                    <span style={{ fontSize: 9.5, color: "var(--green)", fontWeight: 600, letterSpacing: "0.04em" }}>TARGET · {m.targetField}</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {m.outputSample}
                  </div>
                </div>
              </div>

              {m.note && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 10, padding: "7px 10px", background: "var(--mirchi-dim)", border: "1px solid var(--mirchi-glow)", borderRadius: 6 }}>
                  <CornerDownRight size={11} color="var(--mirchi)" style={{ marginTop: 1, flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>{m.note}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MappingPage() {
  const [retailerId, setRetailerId] = useState("walmart");
  const [overrides, setOverrides] = useState<Record<string, MappingStatus>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MappingStatus>("all");
  const [resolved, setResolved] = useState<Record<string, boolean>>({});

  const retailer = RETAILERS.find(r => r.id === retailerId)!;
  const statusOf = (m: Mapping): MappingStatus => overrides[m.id] ?? m.status;

  const rows = useMemo(() => MAPPINGS.filter(m => m.retailer === retailerId), [retailerId]);
  const gaps = useMemo(() => UNMAPPED.filter(u => u.retailer === retailerId), [retailerId]);

  const visible = rows.filter(m => {
    const s = statusOf(m);
    if (filter !== "all" && s !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return m.sourceField.toLowerCase().includes(q) || m.targetField.toLowerCase().includes(q) || m.targetLabel.toLowerCase().includes(q);
  });

  const approved = rows.filter(m => statusOf(m) === "approved").length;
  const pending = rows.filter(m => statusOf(m) === "pending").length;
  const rejected = rows.filter(m => statusOf(m) === "rejected").length;
  const aiCount = rows.filter(m => m.mappedBy === "ai").length;
  const openGaps = gaps.filter(g => !resolved[g.id]).length;
  const coverage = Math.round((approved / (rows.length + gaps.length)) * 100);
  const bulkEligible = rows.filter(m => statusOf(m) === "pending" && m.confidence >= 90);

  const setStatus = (id: string, s: MappingStatus) => setOverrides(p => ({ ...p, [id]: s }));
  const approveAll = () => setOverrides(p => {
    const next = { ...p };
    bulkEligible.forEach(m => { next[m.id] = "approved"; });
    return next;
  });

  const pendingByRetailer = (rid: string) =>
    MAPPINGS.filter(m => m.retailer === rid && (overrides[m.id] ?? m.status) === "pending").length;

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <GitMerge size={15} color="var(--mirchi)" strokeWidth={2} />
                <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Mapping Studio</h1>
                <span style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", background: "var(--surface-overlay)", borderRadius: 4 }}>Step 3 of 6</span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                Source PIM fields mapped to the {retailer.name} schema. AI proposes, a human approves.
              </p>
            </div>

            {bulkEligible.length > 0 && (
              <button onClick={approveAll} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 6,
                background: "var(--mirchi)", border: "none", color: "white",
                fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              }}>
                <Zap size={12} strokeWidth={2.5} />
                Approve {bulkEligible.length} high-confidence
              </button>
            )}
          </div>

          {/* Retailer tabs */}
          <div style={{ display: "flex", gap: 4 }}>
            {RETAILERS.map(r => {
              const active = r.id === retailerId;
              const p = pendingByRetailer(r.id);
              return (
                <button key={r.id} onClick={() => { setRetailerId(r.id); setExpandedId(null); }} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 13px",
                  background: "transparent", border: "none",
                  borderBottom: `2px solid ${active ? "var(--mirchi)" : "transparent"}`,
                  color: active ? "var(--mirchi)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                  transition: "all 0.12s ease",
                }}>
                  {r.name}
                  {p > 0 && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "var(--amber-dim)", color: "var(--amber)" }}>{p}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <motion.div
          key={retailerId + approved + rejected}
          initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
        >
          {[
            { label: "Schema Coverage", value: `${coverage}%`, color: coverage >= 80 ? "var(--green)" : coverage >= 60 ? "var(--amber)" : "var(--red)", note: `of ${rows.length + gaps.length} target fields` },
            { label: "Approved", value: approved, color: "var(--green)", note: "Ready to transform" },
            { label: "Pending Review", value: pending, color: "var(--amber)", note: "Awaiting human approval" },
            { label: "Unmapped Gaps", value: openGaps, color: openGaps > 0 ? "var(--red)" : "var(--green)", note: "No source field" },
            { label: "AI-Proposed", value: aiCount, color: "var(--purple)", note: `${rows.length - aiCount} mapped by hand` },
            { label: "Rejected", value: rejected, color: "var(--text-muted)", note: "Excluded from output" },
          ].map(s => (
            <div key={s.label} style={{ padding: "13px 18px", borderRight: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>{s.note}</div>
            </div>
          ))}
        </motion.div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
            <Search size={12} color="var(--text-muted)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search source or target fields…"
              style={{
                width: "100%", padding: "6px 10px 6px 28px", fontSize: 11.5,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", outline: "none",
              }}
            />
          </div>
          {(["all", "approved", "pending", "rejected"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "5px 11px", fontSize: 11, borderRadius: 6, cursor: "pointer",
              background: filter === f ? "var(--mirchi-dim)" : "transparent",
              border: `1px solid ${filter === f ? "var(--mirchi-glow)" : "var(--border)"}`,
              color: filter === f ? "var(--mirchi)" : "var(--text-secondary)",
              fontWeight: filter === f ? 600 : 400, textTransform: "capitalize",
            }}>{f}</button>
          ))}
        </div>

        {/* Column header */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          {["Source Field", "", "Target Field", "Transform", "Impact", "Confidence", "Status", ""].map((h, i) => (
            <div key={i} style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1 }}>
          {visible.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
              No mappings match this filter.
            </div>
          ) : visible.map(m => (
            <MappingRow
              key={m.id}
              m={m}
              status={statusOf(m)}
              expanded={expandedId === m.id}
              onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
              onApprove={() => setStatus(m.id, "approved")}
              onReject={() => setStatus(m.id, "rejected")}
            />
          ))}

          {/* Unmapped gaps */}
          {gaps.length > 0 && (
            <div style={{ padding: "18px 16px 8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <AlertTriangle size={13} color="var(--red)" />
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Unmapped Target Fields</span>
                <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  — {retailer.name} requires these but no source field exists
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 8 }}>
                {gaps.map(g => {
                  const done = resolved[g.id];
                  return (
                    <div key={g.id} style={{
                      padding: "10px 12px", borderRadius: 7,
                      background: done ? "rgba(34,197,94,0.05)" : "var(--surface)",
                      border: `1px solid ${done ? "rgba(34,197,94,0.2)" : g.required ? "rgba(239,91,78,0.2)" : "var(--border)"}`,
                      transition: "all 0.2s ease",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-primary)" }}>{g.targetField}</span>
                        {g.required && <span style={{ fontSize: 8, fontWeight: 700, color: "var(--red)" }}>REQ</span>}
                        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--text-muted)" }}>{g.affects} SKUs</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>{g.reason}</div>

                      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 9px", background: "var(--surface-overlay)", borderRadius: 5 }}>
                        <Sparkles size={10} color="var(--purple)" style={{ marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{g.aiSuggestion}</div>
                          {g.suggestionConfidence > 0 && (
                            <div style={{ marginTop: 5 }}><ConfidenceBar value={g.suggestionConfidence} /></div>
                          )}
                        </div>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        {done ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: "var(--green)" }}>
                            <Check size={11} strokeWidth={3} /> Mapping rule created
                          </span>
                        ) : g.suggestionConfidence === 0 ? (
                          <span style={{ fontSize: 10.5, color: "var(--red)", fontWeight: 600 }}>Manual work required — routed to creative team</span>
                        ) : (
                          <button onClick={() => setResolved(p => ({ ...p, [g.id]: true }))} style={{
                            display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 5,
                            background: "var(--surface-overlay)", border: "1px solid var(--border)",
                            color: "var(--text-primary)", fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                          }}>
                            <Sparkles size={10} color="var(--purple)" /> Accept AI mapping
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "11px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", position: "sticky", bottom: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {pending > 0 ? (
              <><span style={{ color: "var(--amber)", fontWeight: 600 }}>{pending} mapping{pending === 1 ? "" : "s"}</span> awaiting approval · <span style={{ color: "var(--red)", fontWeight: 600 }}>{openGaps} gap{openGaps === 1 ? "" : "s"}</span> unresolved</>
            ) : openGaps > 0 ? (
              <>All mappings approved · <span style={{ color: "var(--red)", fontWeight: 600 }}>{openGaps} gap{openGaps === 1 ? "" : "s"}</span> still need a source</>
            ) : (
              <span style={{ color: "var(--green)", fontWeight: 600 }}>{retailer.name} schema fully mapped — ready to validate</span>
            )}
          </div>
          <a href="/validation" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--mirchi)", borderRadius: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "white" }}>Run Validation</span>
              <ArrowRight size={12} color="white" />
            </div>
          </a>
        </div>
      </div>
    </AppShell>
  );
}
