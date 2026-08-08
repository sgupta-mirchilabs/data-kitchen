import { AlertTriangle, Braces, CheckCircle2, Clock, FileSpreadsheet, Loader2, XCircle } from "lucide-react";
import type { ImportBatch } from "../../lib/catalog-repository";

interface Props {
  imports: ImportBatch[];
  onClose: () => void;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 size={12} color="var(--green)" />;
  if (status === "completed_with_warnings") return <AlertTriangle size={12} color="var(--amber)" />;
  if (status === "failed") return <XCircle size={12} color="var(--red)" />;
  if (status === "cancelled") return <XCircle size={12} color="var(--text-muted)" />;
  // queued / processing are in-flight, not outcomes.
  if (status === "processing") return <Loader2 size={12} color="var(--mirchi)" />;
  if (status === "queued") return <Clock size={12} color="var(--text-muted)" />;
  return <Clock size={12} color="var(--text-muted)" />;
}

/** Job states read as sentences, not enum values. */
function statusLabel(status: string): string {
  switch (status) {
    case "queued": return "Queued";
    case "processing": return "Processing";
    case "completed": return "Completed";
    case "completed_with_warnings": return "Completed with warnings";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return status.replace(/_/g, " ");
  }
}

export function ImportHistory({ imports }: Props) {
  if (imports.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
        No imports yet.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 80px 80px 60px 60px 60px 60px 80px",
        padding: "8px 16px", background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)",
      }}>
        {["File", "Type", "Source", "Total", "OK", "Warn", "Fail", "Status"].map((col) => (
          <div key={col} style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{col}</div>
        ))}
      </div>

      {imports.map((imp, i) => (
        <div key={imp.id} style={{
          display: "grid", gridTemplateColumns: "1fr 80px 80px 60px 60px 60px 60px 80px",
          padding: "10px 16px", alignItems: "center",
          borderBottom: i < imports.length - 1 ? "1px solid var(--border-subtle)" : "none",
          background: "var(--surface)",
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {imp.filename}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {new Date(imp.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div>
            {imp.fileType === "json"
              ? <Braces size={11} color="var(--text-muted)" />
              : <FileSpreadsheet size={11} color="var(--text-muted)" />}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>{imp.fileType.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{imp.sourceSystem ?? "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 500 }}>{imp.totalRows}</div>
          <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>{imp.successfulRows}</div>
          <div style={{ fontSize: 11, color: imp.warningRows > 0 ? "var(--amber)" : "var(--text-muted)" }}>
            {imp.warningRows}
          </div>
          <div style={{ fontSize: 11, color: imp.failedRows > 0 ? "var(--red)" : "var(--text-muted)" }}>
            {imp.failedRows}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <StatusIcon status={imp.status} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{statusLabel(imp.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
