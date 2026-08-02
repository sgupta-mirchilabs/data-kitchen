import { CheckCircle2, AlertTriangle, XCircle, Package, RefreshCw, ArrowRight } from "lucide-react";

interface ImportResultData {
  totalRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  createdProducts: number;
  updatedProducts: number;
  warnings: Array<{ rowNumber?: number; message: string }>;
  errors: Array<{ rowNumber?: number; message: string }>;
}

interface Props {
  results: ImportResultData;
  onViewCatalog: () => void;
  onUploadAnother: () => void;
}

export function ImportResults({ results, onViewCatalog, onUploadAnother }: Props) {
  const isSuccess = results.failedRows === 0;
  const isPartial = results.failedRows > 0 && results.successfulRows > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Status header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 20px", borderRadius: 8,
        background: isSuccess ? "var(--green-dim)" : isPartial ? "var(--amber-dim)" : "var(--red-dim)",
        border: `1px solid ${isSuccess ? "rgba(34,197,94,0.2)" : isPartial ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}`,
      }}>
        {isSuccess && <CheckCircle2 size={20} color="var(--green)" />}
        {isPartial && <AlertTriangle size={20} color="var(--amber)" />}
        {!isSuccess && !isPartial && <XCircle size={20} color="var(--red)" />}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            {isSuccess ? "Import completed successfully" : isPartial ? "Import completed with warnings" : "Import failed"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {results.totalRows} rows processed
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1,
        background: "var(--border)", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        {[
          { icon: Package, label: "Created", value: results.createdProducts, color: "var(--green)" },
          { icon: RefreshCw, label: "Updated", value: results.updatedProducts, color: "var(--blue)" },
          { icon: AlertTriangle, label: "Warnings", value: results.warningRows, color: "var(--amber)" },
          { icon: XCircle, label: "Failed", value: results.failedRows, color: "var(--red)" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} style={{ background: "var(--surface)", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <Icon size={11} color={value > 0 ? color : "var(--text-muted)"} />
              <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: value > 0 ? color : "var(--text-primary)", letterSpacing: "-0.02em" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Errors */}
      {results.errors.length > 0 && (
        <div style={{
          borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden",
          maxHeight: 200, overflowY: "auto",
        }}>
          <div style={{
            padding: "8px 12px", background: "var(--surface-raised)",
            fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
            letterSpacing: "0.06em", textTransform: "uppercase",
            borderBottom: "1px solid var(--border)",
          }}>
            Errors ({results.errors.length})
          </div>
          {results.errors.slice(0, 20).map((err, i) => (
            <div key={i} style={{
              padding: "6px 12px", fontSize: 11, color: "var(--red)",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <XCircle size={10} /> {err.message}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {results.warnings.length > 0 && (
        <div style={{
          borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden",
          maxHeight: 150, overflowY: "auto",
        }}>
          <div style={{
            padding: "8px 12px", background: "var(--surface-raised)",
            fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
            letterSpacing: "0.06em", textTransform: "uppercase",
            borderBottom: "1px solid var(--border)",
          }}>
            Warnings ({results.warnings.length})
          </div>
          {results.warnings.slice(0, 20).map((w, i) => (
            <div key={i} style={{
              padding: "6px 12px", fontSize: 11, color: "var(--amber)",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <AlertTriangle size={10} /> {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onUploadAnother} style={{
          padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--surface)", color: "var(--text-secondary)",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>
          Upload Another File
        </button>
        <button onClick={onViewCatalog} style={{
          padding: "7px 16px", borderRadius: 6, border: "none",
          background: "var(--mirchi)", color: "white",
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          View Catalog <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
