/**
 * Active-catalog resolution.
 *
 * Kept free of React and browser globals (beyond guarded sessionStorage access)
 * so the rules can be unit tested directly.
 *
 * The rule that matters: when an organization has several catalogs, the app must
 * never pick one on the user's behalf. Silently defaulting to the first catalog
 * routed seven consecutive imports into the wrong catalog (KI-1).
 */

export interface CatalogSummary {
  id: string;
  name: string;
  catalogType?: string;
}

export type CatalogResolution =
  /** Organization has no catalogs — imports must be blocked. */
  | { status: "no-catalogs"; catalogId: null }
  /** Exactly one catalog, so there is nothing to choose. */
  | { status: "auto-selected"; catalogId: string }
  /** Several catalogs, and the stored choice is still valid. */
  | { status: "restored"; catalogId: string }
  /** Several catalogs and no valid stored choice — the user must choose. */
  | { status: "needs-selection"; catalogId: null };

const STORAGE_PREFIX = "data-kitchen:selected-catalog:";

/** Storage is scoped per organization so a catalog can never leak across tenants. */
export function catalogStorageKey(organizationId: string): string {
  return `${STORAGE_PREFIX}${organizationId}`;
}

export function resolveActiveCatalog(
  catalogs: CatalogSummary[],
  storedCatalogId: string | null,
): CatalogResolution {
  if (catalogs.length === 0) return { status: "no-catalogs", catalogId: null };

  // A single catalog is unambiguous: selecting it is not a guess.
  if (catalogs.length === 1) return { status: "auto-selected", catalogId: catalogs[0].id };

  // A stored id is only honoured if it is still one of this organization's
  // catalogs. Anything else (stale, deleted, or belonging to another org) is
  // discarded rather than trusted.
  if (storedCatalogId && catalogs.some((c) => c.id === storedCatalogId)) {
    return { status: "restored", catalogId: storedCatalogId };
  }

  return { status: "needs-selection", catalogId: null };
}

export function readStoredCatalogId(organizationId: string | null): string | null {
  if (!organizationId) return null;
  try {
    return sessionStorage.getItem(catalogStorageKey(organizationId));
  } catch {
    return null;
  }
}

export function writeStoredCatalogId(organizationId: string | null, catalogId: string): void {
  if (!organizationId) return;
  try {
    sessionStorage.setItem(catalogStorageKey(organizationId), catalogId);
  } catch {
    /* storage unavailable — selection simply will not persist */
  }
}

export function clearStoredCatalogId(organizationId: string | null): void {
  if (!organizationId) return;
  try {
    sessionStorage.removeItem(catalogStorageKey(organizationId));
  } catch {
    /* ignore */
  }
}

/** Display label for catalog_type. Returns null when there is nothing useful to show. */
export function catalogTypeLabel(catalogType?: string): string | null {
  const t = (catalogType ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "production") return "Production";
  if (t === "test") return "Test";
  if (t === "sandbox") return "Sandbox";
  return "Other";
}

/** Production catalogs are visually distinguished. No behavioural safeguards here yet. */
export function isProductionCatalog(catalogType?: string): boolean {
  return (catalogType ?? "").trim().toLowerCase() === "production";
}
