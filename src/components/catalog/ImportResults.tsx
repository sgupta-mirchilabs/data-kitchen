import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getSelectedOrganizationName } from "../../lib/api-client";

interface ResultsData {
  importBatchId?: string;
  totalRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  createdProducts: number;
  updatedProducts: number;
  warnings: Array<{ rowNumber?: number; message: string }>;
  errors: Array<{ rowNumber?: number; message: string }>;
  validationIssues?: Array<{ rowNumber: number; code: string; message: string; field: string }>;
  skippedRows?: number;
  durationMs?: number;
  filename?: string;
  savedTemplate?: { id: string; version: number; created: boolean } | null;
}

interface Props {
  results: ResultsData;
  filename?: string;
  catalogName?: string;
  onViewCatalog: () => void;
  onUploadAnother: () => void;
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function ImportResults({ results, filename, catalogName, onViewCatalog, onUploadAnother }: Props) {
  const failed = results.failedRows > 0 || results.errors.length > 0;
  const warned = results.warningRows > 0 || results.warnings.length > 0;
  const organizationName = getSelectedOrganizationName();

  const headline = failed
    ? { icon: XCircle, color: "var(--red)", bg: "var(--red-dim)", text: "Import completed with errors" }
    : warned
      ? { icon: AlertTriangle, color: "var(--amber)", bg: "var(--amber-dim)", text: "Import completed with warnings" }
      : { icon: CheckCircle2, color: "var(--green)", bg: "var(--green-dim)", text: "Import completed" };
  const HeadlineIcon = headline.icon;

  const counts = [
    { label: "Products Created", value: results.createdProducts },
    { label: "Products Updated", value: results.updatedProducts },
    { label: "Warnings", value: results.warnings.length, warn: results.warnings.length > 0 },
    { label: "Errors", value: results.errors.length, bad: results.errors.length > 0 },
    { label: "Skipped", value: results.skippedRows ?? 0 },
  ];

  const details: Array<[string, string]> = [
    ["Duration", formatDuration(results.durationMs)],
    ["Catalog", catalogName ?? "—"],
    ["Organization", organizationName ?? "—"],
    ["Source file", results.filename ?? filename ?? "—"],
    ["Import ID", results.importBatchId ?? "—"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        borderRadius: 8, background: headline.bg, border: `1px solid ${headline.color}33`,
      }}>
        <HeadlineIcon size={17} color={headline.color} />
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {headline.text}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
          {results.successfulRows}/{results.totalRows} rows processed
        </div>
      </div>

      {/* Counts */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1,
        background: "var(--border)", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        {counts.map((c) => (
          <div key={c.label} style={{ background: "var(--surface)", padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em",
              color: c.bad ? "var(--red)" : c.warn ? "var(--amber)" : "var(--text-primary)",
            }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Provenance of this run */}
      <div style={{
        border: "1px solid var(--border-subtle)", borderRadius: 8,
        background: "var(--surface)", padding: "10px 14px",
      }}>
        {details.map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 12, padding: "3px 0", fontSize: 11 }}>
            <span style={{ width: 110, color: "var(--text-muted)", flexShrink: 0 }}>{k}</span>
            <span style={{
              color: "var(--text-secondary)", fontFamily: k === "Import ID" ? "monospace" : undefined,
              wordBreak: "break-all",
            }}>
              {v}
            </span>
          </div>
        ))}
        {results.savedTemplate && (
          <div style={{ display: "flex", gap: 12, padding: "3px 0", fontSize: 11 }}>
            <span style={{ width: 110, color: "var(--text-muted)", flexShrink: 0 }}>Mapping</span>
            <span style={{ color: "var(--green)" }}>
              {results.savedTemplate.created ? "Saved as new template" : "Existing template updated"} (v{results.savedTemplate.version})
            </span>
          </div>
        )}
      </div>

      {/* Validation issues */}
      {results.validationIssues && results.validationIssues.length > 0 && (
        <IssueList
          title={`Validation warnings (${results.validationIssues.length})`}
          color="var(--amber)"
          items={results.validationIssues.map((i) => ({ rowNumber: i.rowNumber, message: i.message }))}
        />
      )}

      {results.errors.length > 0 && (
        <IssueList title={`Errors (${results.errors.length})`} color="var(--red)" items={results.errors} />
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onViewCatalog} style={{
          padding: "8px 16px", borderRadius: 6, border: "none",
          background: "var(--mirchi)", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>
          Open Catalog
        </button>
        <button onClick={onUploadAnother} style={{
          padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--surface-raised)", color: "var(--text-secondary)",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>
          Import Another File
        </button>
      </div>
    </div>
  );
}

function IssueList({
  title, color, items,
}: {
  title: string;
  color: string;
  items: Array<{ rowNumber?: number; message: string }>;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{
        padding: "8px 14px", background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color,
      }}>
        {title}
      </div>
      <div style={{ maxHeight: 180, overflowY: "auto" }}>
        {items.slice(0, 50).map((item, i) => (
          <div key={i} style={{
            padding: "6px 14px", fontSize: 11, color: "var(--text-secondary)",
            borderBottom: i < Math.min(items.length, 50) - 1 ? "1px solid var(--border-subtle)" : "none",
          }}>
            {item.rowNumber != null && (
              <span style={{ color: "var(--text-muted)", fontFamily: "monospace", marginRight: 8 }}>
                row {item.rowNumber}
              </span>
            )}
            {item.message}
          </div>
        ))}
        {items.length > 50 && (
          <div style={{ padding: "6px 14px", fontSize: 11, color: "var(--text-muted)" }}>
            …and {items.length - 50} more.
          </div>
        )}
      </div>
    </div>
  );
}
