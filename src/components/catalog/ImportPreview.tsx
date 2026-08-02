import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
}

interface ParseWarning {
  rowNumber?: number;
  column?: string;
  message: string;
  type: string;
}

interface Props {
  headers: string[];
  sampleRows: ParsedRow[];
  totalRows: number;
  warnings: ParseWarning[];
  filename: string;
  onContinue: () => void;
  onCancel: () => void;
}

export function ImportPreview({ headers, sampleRows, totalRows, warnings, filename, onContinue, onCancel }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderRadius: 8, background: "var(--surface-raised)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <CheckCircle2 size={16} color="var(--green)" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              {filename}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {totalRows} rows · {headers.length} columns
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Showing first {sampleRows.length} of {totalRows} rows
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "var(--amber-dim)", border: "1px solid rgba(245,158,11,0.2)",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--amber)" }}>
              <AlertTriangle size={11} /> {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ overflow: "auto", maxHeight: 400, borderRadius: 8, border: "1px solid var(--border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--surface-raised)", zIndex: 1 }}>
              <th style={{ padding: "8px 10px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                #
              </th>
              {headers.map((h) => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row) => (
              <tr key={row.rowNumber} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "6px 10px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 10 }}>
                  {row.rowNumber}
                </td>
                {headers.map((h) => (
                  <td key={h} style={{
                    padding: "6px 10px", color: row.data[h] ? "var(--text-primary)" : "var(--text-muted)",
                    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {row.data[h] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={{
          padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--surface)", color: "var(--text-secondary)",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>
          Cancel
        </button>
        <button onClick={onContinue} style={{
          padding: "7px 16px", borderRadius: 6, border: "none",
          background: "var(--mirchi)", color: "white",
          fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>
          Map Fields
        </button>
      </div>
    </div>
  );
}
