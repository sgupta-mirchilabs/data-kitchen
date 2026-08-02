import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/shell/AppShell";
import { FEEDBACK, RESOLVED_LOG, RESOLUTION_META, type RetailerFeedback } from "../lib/feedback-data";
import {
  MessageSquareWarning, RefreshCw, ChevronDown, ChevronRight, Search, Terminal,
  Lightbulb, Wrench, ArrowRight, Check, Send, Repeat, Clock, TrendingDown, Sparkles,
} from "lucide-react";

const money = (n: number) => `$${n.toLocaleString()}`;

const GRID = "1fr 92px 116px 74px 82px 128px 22px";

function RecurrenceTag({ n }: { n: number }) {
  if (n <= 1) return <span style={{ fontSize: 10, color: "var(--text-muted)" }}>First time</span>;
  const hot = n >= 4;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      color: hot ? "var(--red)" : "var(--amber)",
    }}>
      <Repeat size={9} /> {n}× this quarter
    </span>
  );
}

function FeedbackRow({ f, queued, expanded, onToggle, onQueue }: {
  f: RetailerFeedback; queued: boolean; expanded: boolean; onToggle: () => void; onQueue: () => void;
}) {
  const rm = RESOLUTION_META[f.resolution];
  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center",
          padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
          background: expanded ? "var(--surface-raised)" : queued ? "rgba(34,197,94,0.03)" : "transparent",
          transition: "background 0.12s ease",
        }}
      >
        {/* Error code + product */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Terminal size={11} color="var(--red)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--red)", fontWeight: 600 }}>{f.rawCode}</span>
            <span style={{ fontSize: 10.5, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.field}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {f.productName} · {f.sku}
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{f.retailer}</div>

        <div>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, color: rm.color, background: "var(--surface-overlay)", border: `1px solid ${rm.color}25`, whiteSpace: "nowrap" }}>
            {rm.label}
          </span>
        </div>

        <div style={{ fontSize: 11, color: f.daysOffline > 3 ? "var(--red)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {f.daysOffline === 0 ? "—" : `${f.daysOffline}d`}
        </div>

        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>
          {money(f.revenueUsd)}
        </div>

        <div onClick={e => e.stopPropagation()}>
          {queued ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "var(--green)", padding: "2px 8px", borderRadius: 10, background: "var(--green-dim)" }}>
              <Check size={10} strokeWidth={3} /> In resubmit queue
            </span>
          ) : (
            <button onClick={onQueue} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 5,
              background: "var(--surface-overlay)", border: "1px solid var(--border)",
              color: "var(--text-primary)", fontSize: 10.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
              <Wrench size={10} color="var(--mirchi)" /> Queue fix
            </button>
          )}
        </div>

        <div style={{ color: "var(--text-muted)", display: "flex", justifyContent: "center" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }} style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "12px 16px 16px 40px", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 9 }}>

              {/* Raw */}
              <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <Terminal size={10} color="var(--text-muted)" />
                  <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>What {f.retailer} Sent Back</span>
                </div>
                <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {f.rawMessage}
                </div>
              </div>

              {/* Decoded */}
              <div style={{ background: "var(--mirchi-dim)", border: "1px solid var(--mirchi-glow)", borderRadius: 6, padding: "9px 11px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                  <Lightbulb size={10} color="var(--mirchi)" />
                  <span style={{ fontSize: 9.5, color: "var(--mirchi)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>What It Actually Means</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-primary)", lineHeight: 1.55 }}>{f.decoded}</div>
              </div>

              {/* Root cause + fix */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                <div style={{ background: "var(--surface-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>Root Cause</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>{f.rootCause}</div>
                </div>
                <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 9.5, color: "var(--green)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Fix Path</span>
                    {f.confidence > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "var(--green)" }}>
                        <Sparkles size={9} /> {f.confidence}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>{f.fixPath}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 10.5, color: "var(--text-muted)" }}>
                <RecurrenceTag n={f.recurrence} />
                {f.owner && <span>Owner: <span style={{ color: "var(--text-secondary)" }}>{f.owner}</span></span>}
                <span>Received {new Date(f.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function FeedbackPage() {
  const [queue, setQueue] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [retailerFilter, setRetailerFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  const retailers = ["all", ...Array.from(new Set(FEEDBACK.map(f => f.retailer)))];

  const open = FEEDBACK.filter(f => !submitted[f.id]);
  const queued = open.filter(f => queue[f.id]);
  const blockedRevenue = open.reduce((s, f) => s + f.revenueUsd, 0);
  const skusOffline = new Set(open.map(f => f.sku)).size;
  const autoCount = open.filter(f => f.resolution === "auto").length;
  const avgDays = RESOLVED_LOG.reduce((s, r) => s + r.days, 0) / RESOLVED_LOG.length;
  const recovered = FEEDBACK.filter(f => submitted[f.id]).reduce((s, f) => s + f.revenueUsd, 0);

  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(() => setSyncing(false), 1400);
    return () => clearTimeout(t);
  }, [syncing]);

  useEffect(() => {
    if (!resubmitting) return;
    const t = setTimeout(() => {
      setSubmitted(p => {
        const next = { ...p };
        queued.forEach(f => { next[f.id] = true; });
        return next;
      });
      setQueue({});
      setResubmitting(false);
    }, 1600);
    return () => clearTimeout(t);
  }, [resubmitting, queued]);

  const visible = open.filter(f => {
    if (retailerFilter !== "all" && f.retailer !== retailerFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return f.rawCode.toLowerCase().includes(q) || f.sku.toLowerCase().includes(q)
      || f.field.toLowerCase().includes(q) || f.decoded.toLowerCase().includes(q);
  }).sort((a, b) => b.revenueUsd - a.revenueUsd);

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <MessageSquareWarning size={15} color="var(--mirchi)" strokeWidth={2} />
              <h1 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Retail Feedback</h1>
              <span style={{ fontSize: 9.5, color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", background: "var(--surface-overlay)", borderRadius: 4 }}>Step 6 of 6</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              Retailer rejections decoded into plain English, traced to a root cause, and routed back into the pipeline.
            </p>
          </div>

          <button onClick={() => setSyncing(true)} disabled={syncing} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 6,
            background: "var(--surface-overlay)", border: "1px solid var(--border)",
            color: "var(--text-primary)", fontSize: 11.5, fontWeight: 600, cursor: syncing ? "default" : "pointer",
          }}>
            <RefreshCw size={12} className={syncing ? "dk-spin" : undefined} />
            {syncing ? "Pulling from 5 portals…" : "Sync retailer feedback"}
          </button>
        </div>

        {/* Stats */}
        <motion.div
          key={`${open.length}-${blockedRevenue}`}
          initial={{ opacity: 0.65 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
          style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
        >
          {[
            { label: "Revenue Blocked", value: money(blockedRevenue), color: blockedRevenue > 0 ? "var(--red)" : "var(--green)", note: "Monthly, from rejections" },
            { label: "SKUs Offline", value: String(skusOffline), color: "var(--red)", note: "Not live on ≥1 channel" },
            { label: "Open Rejections", value: String(open.length), color: "var(--amber)", note: `across ${retailers.length - 1} retailers` },
            { label: "Auto-Resolvable", value: String(autoCount), color: "var(--green)", note: "Rule already exists" },
            { label: "Avg Time to Fix", value: `${avgDays.toFixed(1)}d`, color: "var(--blue)", note: "Last 30 days" },
            { label: "Recovered", value: money(recovered), color: "var(--green)", note: "This session" },
          ].map(s => (
            <div key={s.label} style={{ padding: "13px 18px", borderRight: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2 }}>{s.note}</div>
            </div>
          ))}
        </motion.div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340 }}>
            <Search size={12} color="var(--text-muted)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search error code, SKU, or field…"
              style={{
                width: "100%", padding: "6px 10px 6px 28px", fontSize: 11.5,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", outline: "none",
              }}
            />
          </div>
          {retailers.map(r => (
            <button key={r} onClick={() => setRetailerFilter(r)} style={{
              padding: "5px 11px", fontSize: 11, borderRadius: 6, cursor: "pointer",
              background: retailerFilter === r ? "var(--mirchi-dim)" : "transparent",
              border: `1px solid ${retailerFilter === r ? "var(--mirchi-glow)" : "var(--border)"}`,
              color: retailerFilter === r ? "var(--mirchi)" : "var(--text-secondary)",
              fontWeight: retailerFilter === r ? 600 : 400, whiteSpace: "nowrap",
            }}>{r === "all" ? "All retailers" : r}</button>
          ))}
        </div>

        {/* Column header */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "7px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
          {["Error / Product", "Retailer", "Resolution", "Offline", "Impact", "Action", ""].map((h, i) => (
            <div key={i} style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1 }}>
          {visible.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <Check size={26} color="var(--green)" strokeWidth={2.5} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>No open rejections</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Every retailer issue has been routed and resubmitted.</div>
            </div>
          ) : visible.map(f => (
            <FeedbackRow
              key={f.id}
              f={f}
              queued={!!queue[f.id]}
              expanded={expandedId === f.id}
              onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
              onQueue={() => setQueue(p => ({ ...p, [f.id]: true }))}
            />
          ))}

          {/* Resolved log */}
          <div style={{ padding: "18px 16px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <TrendingDown size={13} color="var(--green)" />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Recently Resolved</span>
              <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>— closed loop, back live on channel</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 7 }}>
              {RESOLVED_LOG.map(r => {
                const rm = RESOLUTION_META[r.method];
                return (
                  <div key={r.id} style={{ padding: "9px 11px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 500 }}>{r.retailer}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--green)" }}>+{money(r.revenueUsd)}/mo</span>
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)", marginBottom: 5 }}>{r.sku} · {r.field}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9.5, color: "var(--text-muted)" }}>
                      <span style={{ color: rm.color, fontWeight: 600 }}>{rm.label}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={9} /> {r.days}d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer — resubmit queue */}
        <div style={{ padding: "11px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", position: "sticky", bottom: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {queued.length > 0 ? (
              <><span style={{ color: "var(--green)", fontWeight: 600 }}>{queued.length} fix{queued.length === 1 ? "" : "es"} queued</span> · {money(queued.reduce((s, f) => s + f.revenueUsd, 0))}/mo waiting to come back online</>
            ) : open.length === 0 ? (
              <span style={{ color: "var(--green)", fontWeight: 600 }}>Queue clear — {money(recovered)}/mo recovered this session</span>
            ) : (
              <>Queue a fix to add it to the resubmission batch</>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <a href="/intake" style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                <ArrowRight size={12} color="var(--text-muted)" />
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>Back to Intake</span>
              </div>
            </a>
            <button
              onClick={() => setResubmitting(true)}
              disabled={queued.length === 0 || resubmitting}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, border: "none",
                background: queued.length > 0 ? "var(--mirchi)" : "var(--surface-overlay)",
                color: queued.length > 0 ? "white" : "var(--text-muted)",
                fontSize: 12, fontWeight: 600, cursor: queued.length > 0 && !resubmitting ? "pointer" : "default",
              }}
            >
              {resubmitting
                ? <><RefreshCw size={12} className="dk-spin" /> Resubmitting…</>
                : <><Send size={12} /> Resubmit {queued.length > 0 ? queued.length : ""} to retailers</>}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
