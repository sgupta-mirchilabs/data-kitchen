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
  templateMatch?: {
    kind: "exact" | "partial" | "none";
    version: number | null;
    newHeaders: string[];
    missingHeaders: string[];
  };
  duplicates?: {
    groups: Array<{
      sku: string; occurrences: number; rowNumbers: number[];
      winningRow: number; overwrittenRows: number[];
    }>;
    overwrittenRows: number;
  };
  onContinue: () => void;
  onReviewMapping?: () => void;
  onCancel: () => void;
}

export function ImportPreview({ headers, sampleRows, totalRows, warnings, filename, templateMatch, duplicates, onContinue, onReviewMapping, onCancel }: Props) {
  const dupGroups = duplicates?.groups ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Saved mapping template */}
      {templateMatch && templateMatch.kind !== "none" && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
          borderRadius: 8, background: "var(--green-dim)",
          border: "1px solid rgba(34,197,94,0.25)",
        }}>
          <CheckCircle2 size={15} color="var(--green)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
              {templateMatch.kind === "exact"
                ? "Existing mapping applied."
                : "Existing mapping applied to matching columns."}
              {templateMatch.version != null && (
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (v{templateMatch.version})</span>
              )}
            </div>
            {templateMatch.kind === "partial" && (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>
                {templateMatch.newHeaders.length > 0 && (
                  <div>New columns needing mapping: {templateMatch.newHeaders.join(", ")}</div>
                )}
                {templateMatch.missingHeaders.length > 0 && (
                  <div>Previously mapped columns not in this file: {templateMatch.missingHeaders.join(", ")}</div>
                )}
              </div>
            )}
          </div>
          {onReviewMapping && (
            <button onClick={onReviewMapping} style={{
              padding: "4px 10px", fontSize: 11, borderRadius: 5,
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0,
            }}>
              Review Mapping
            </button>
          )}
        </div>
      )}

      {/* Duplicate business keys within this file */}
      {dupGroups.length > 0 && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, background: "var(--amber-dim)",
          border: "1px solid rgba(245,158,11,0.25)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <AlertTriangle size={14} color="var(--amber)" />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
              Duplicate SKU detected
            </span>
          </div>
          {dupGroups.map((g) => (
            <div key={g.sku} style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
              <div style={{ color: "var(--text-primary)" }}>
                SKU <strong>{g.sku}</strong> appears {g.occurrences} times.
              </div>
              <div>Rows: {g.rowNumbers.join(", ")}</div>
              <div>
                Resolution: row {g.winningRow} will overwrite row{g.overwrittenRows.length > 1 ? "s" : ""}{" "}
                {g.overwrittenRows.join(", ")}.
              </div>
            </div>
          ))}
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(245,158,11,0.2)",
            fontSize: 11, color: "var(--text-secondary)",
          }}>
            {/* State the not-yet-committed guarantee outright. Inferring it from
                a "Continue?" prompt asks the operator to trust an implication at
                exactly the moment they need certainty. */}
            <strong style={{ color: "var(--text-primary)" }}>Nothing has been imported yet.</strong>{" "}
            No products have been created or updated. {duplicates?.overwrittenRows ?? 0} row
            {(duplicates?.overwrittenRows ?? 0) === 1 ? "" : "s"} will be superseded if you continue.
          </div>
        </div>
      )}

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
