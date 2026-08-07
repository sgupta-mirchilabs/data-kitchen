import { catalogTypeLabel, isProductionCatalog, type CatalogSummary } from "../../lib/catalog-selection";

export function CatalogTypeBadge({ catalogType }: { catalogType?: string }) {
  const label = catalogTypeLabel(catalogType);
  if (!label) return null;
  const production = isProductionCatalog(catalogType);
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: production ? "var(--amber)" : "var(--text-muted)",
        background: production ? "var(--amber-dim)" : "var(--surface-overlay)",
        border: `1px solid ${production ? "var(--amber-dim)" : "var(--border)"}`,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Always-visible active-catalog control.
 *
 * Deliberately sits in the workspace header rather than inside the import
 * wizard: the operator must be able to see which catalog is active before
 * starting an import, not only during one.
 */
export function CatalogSelector({
  organizationName,
  catalogs,
  activeCatalogId,
  onSelect,
  disabled,
}: {
  organizationName: string | null;
  catalogs: CatalogSummary[];
  activeCatalogId: string | null;
  onSelect: (catalogId: string) => void;
  disabled?: boolean;
}) {
  const active = catalogs.find((c) => c.id === activeCatalogId) ?? null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      {organizationName && (
        <Field label="Organization">
          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>
            {organizationName}
          </span>
        </Field>
      )}

      <Field label="Catalog">
        {catalogs.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No catalogs available</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={activeCatalogId ?? ""}
              disabled={disabled}
              onChange={(e) => {
                if (e.target.value) onSelect(e.target.value);
              }}
              aria-label="Active catalog"
              style={{
                background: "var(--surface-raised)",
                border: `1px solid ${activeCatalogId ? "var(--border)" : "var(--mirchi)"}`,
                borderRadius: 6,
                color: activeCatalogId ? "var(--text-primary)" : "var(--mirchi)",
                fontSize: 12,
                fontWeight: 500,
                padding: "5px 8px",
                cursor: disabled ? "not-allowed" : "pointer",
                minWidth: 190,
              }}
            >
              {/* Present only until a choice is made; never auto-resolves to a real catalog. */}
              {!activeCatalogId && <option value="">Select a catalog…</option>}
              {catalogs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {active && <CatalogTypeBadge catalogType={active.catalogType} />}
          </div>
        )}
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
