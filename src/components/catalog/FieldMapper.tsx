import { useState } from "react";
import { ArrowRight, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";

interface Props {
  headers: string[];
  suggestedMappings: Record<string, string>;
  onConfirm: (mappings: Record<string, string>) => void;
  onBack: () => void;
}

const CORE_FIELDS = [
  { key: "sku", label: "SKU", required: false },
  { key: "gtin", label: "GTIN / UPC", required: false },
  { key: "product_name", label: "Product Name", required: true },
  { key: "brand", label: "Brand", required: true },
  { key: "category", label: "Category", required: true },
  { key: "short_description", label: "Short Description", required: false },
  { key: "long_description", label: "Long Description", required: false },
  { key: "manufacturer", label: "Manufacturer", required: false },
] as const;

export function FieldMapper({ headers, suggestedMappings, onConfirm, onBack }: Props) {
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of CORE_FIELDS) {
      if (suggestedMappings[field.key]) {
        initial[field.key] = suggestedMappings[field.key];
      }
    }
    return initial;
  });

  function setMapping(canonical: string, source: string) {
    setMappings((prev) => {
      const next = { ...prev };
      if (source === "") {
        delete next[canonical];
      } else {
        next[canonical] = source;
      }
      return next;
    });
  }

  const mappedCount = Object.keys(mappings).length;
  const requiredMapped = CORE_FIELDS
    .filter((f) => f.required)
    .every((f) => mappings[f.key]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        padding: "12px 16px", borderRadius: 8, background: "var(--surface-raised)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          Identify Core Fields
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Map your source columns to Data Kitchen's canonical fields. Unmapped columns are preserved as attributes.
        </div>
      </div>

      <div style={{
        display: "flex", flexDirection: "column", gap: 1,
        borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden",
      }}>
        {CORE_FIELDS.map((field) => {
          const mapped = mappings[field.key];
          const wasSuggested = suggestedMappings[field.key] === mapped && !!mapped;

          return (
            <div key={field.key} style={{
              display: "grid", gridTemplateColumns: "180px 24px 1fr 24px",
              alignItems: "center", gap: 8,
              padding: "10px 16px", background: "var(--surface)",
              borderBottom: "1px solid var(--border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  {field.label}
                </span>
                {field.required && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: "var(--red)", textTransform: "uppercase" }}>req</span>
                )}
              </div>

              <ArrowRight size={12} color="var(--text-muted)" />

              <select
                value={mapped ?? ""}
                onChange={(e) => setMapping(field.key, e.target.value)}
                style={{
                  padding: "5px 8px", borderRadius: 5,
                  border: `1px solid ${mapped ? "var(--green)" : "var(--border)"}`,
                  background: mapped ? "var(--green-dim)" : "var(--surface-raised)",
                  color: mapped ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: 12, cursor: "pointer", outline: "none",
                }}
              >
                <option value="">— not mapped —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>

              <div style={{ width: 20, display: "flex", justifyContent: "center" }}>
                {mapped && wasSuggested && <Sparkles size={12} color="var(--amber)" aria-label="Auto-suggested" />}
                {mapped && !wasSuggested && <CheckCircle2 size={12} color="var(--green)" />}
                {!mapped && field.required && <AlertTriangle size={12} color="var(--red)" />}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 8, background: "var(--surface-raised)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {mappedCount} of {CORE_FIELDS.length} fields mapped
          {!requiredMapped && (
            <span style={{ color: "var(--amber)", marginLeft: 8 }}>
              · Required fields are not fully mapped
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onBack} style={{
          padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--surface)", color: "var(--text-secondary)",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>
          Back
        </button>
        <button
          onClick={() => onConfirm(mappings)}
          style={{
            padding: "7px 16px", borderRadius: 6, border: "none",
            background: "var(--mirchi)", color: "white",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            opacity: mappedCount === 0 ? 0.5 : 1,
          }}
          disabled={mappedCount === 0}
        >
          Start Import
        </button>
      </div>
    </div>
  );
}
