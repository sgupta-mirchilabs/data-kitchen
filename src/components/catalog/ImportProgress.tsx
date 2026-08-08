import { Loader2, XCircle } from "lucide-react";

interface StatusLike {
  status: string;
  filename: string;
  totalRows: number;
  progressRows: number;
  elapsedMs: number | null;
  cancelRequested: boolean;
  attempts: number;
}

interface Props {
  isComplete: boolean;
  status?: StatusLike | null;
  onCancel?: () => void;
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Shown while a queued or processing import runs.
 *
 * The reassurance line is the point of the whole phase: processing is owned by
 * a background worker, so leaving the page cannot affect it.
 */
export function ImportProgress({ status, onCancel }: Props) {
  const total = status?.totalRows ?? 0;
  const done = status?.progressRows ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const queued = status?.status === "queued";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "24px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Loader2 size={16} color="var(--mirchi)" style={{ animation: "spin 1s linear infinite" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {queued ? "Queued" : "Processing"}{status?.filename ? ` ${status.filename}` : ""}
        </div>
        {status?.cancelRequested && (
          <span style={{ fontSize: 11, color: "var(--amber)" }}>Cancelling at next checkpoint…</span>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {queued
          ? "Waiting for a worker to pick this up."
          : `${done.toLocaleString()} / ${total.toLocaleString()} rows processed`}
      </div>

      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-overlay)", overflow: "hidden" }}>
        <div style={{
          width: `${queued ? 0 : pct}%`, height: "100%", background: "var(--mirchi)",
          transition: "width 0.4s ease",
        }} />
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-muted)" }}>
        <span>Elapsed {formatElapsed(status?.elapsedMs ?? null)}</span>
        {status && status.attempts > 1 && <span>Attempt {status.attempts}</span>}
      </div>

      <div style={{
        marginTop: 4, padding: "10px 12px", borderRadius: 8,
        background: "var(--surface-raised)", border: "1px solid var(--border)",
        fontSize: 12, color: "var(--text-secondary)",
      }}>
        <strong style={{ color: "var(--text-primary)" }}>You can leave this page.</strong>{" "}
        Processing continues in the background. Return to Import History at any time to see the result.
      </div>

      {onCancel && !status?.cancelRequested && (
        <div>
          <button onClick={onCancel} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
            borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
          }}>
            <XCircle size={13} /> Cancel import
          </button>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            Rows already committed remain in the catalog and are not rolled back.
          </div>
        </div>
      )}
    </div>
  );
}
