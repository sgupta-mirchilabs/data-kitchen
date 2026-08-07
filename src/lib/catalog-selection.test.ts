import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveActiveCatalog,
  catalogStorageKey,
  readStoredCatalogId,
  writeStoredCatalogId,
  clearStoredCatalogId,
  catalogTypeLabel,
  isProductionCatalog,
  type CatalogSummary,
} from "./catalog-selection";

const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

const SANDBOX: CatalogSummary = { id: "cat-sandbox", name: "Import Sandbox", catalogType: "test" };
const Q3: CatalogSummary = { id: "cat-q3", name: "Q3 Product Feed", catalogType: "production" };

// Minimal sessionStorage stand-in; the module accesses it directly.
function installStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
  return data;
}

describe("resolveActiveCatalog", () => {
  it("reports no-catalogs for an empty list", () => {
    expect(resolveActiveCatalog([], null)).toEqual({ status: "no-catalogs", catalogId: null });
  });

  it("auto-selects when exactly one catalog exists", () => {
    expect(resolveActiveCatalog([SANDBOX], null)).toEqual({
      status: "auto-selected",
      catalogId: SANDBOX.id,
    });
  });

  it("auto-selects the single catalog even if a stale id was stored", () => {
    expect(resolveActiveCatalog([SANDBOX], "cat-deleted")).toEqual({
      status: "auto-selected",
      catalogId: SANDBOX.id,
    });
  });

  it("requires explicit selection when several catalogs exist and nothing is stored", () => {
    expect(resolveActiveCatalog([SANDBOX, Q3], null)).toEqual({
      status: "needs-selection",
      catalogId: null,
    });
  });

  it("never falls back to the first catalog (the KI-1 defect)", () => {
    const result = resolveActiveCatalog([SANDBOX, Q3], null);
    expect(result.catalogId).toBeNull();
    expect(result.catalogId).not.toBe(SANDBOX.id);
  });

  it("restores a stored catalog that is still valid", () => {
    expect(resolveActiveCatalog([SANDBOX, Q3], Q3.id)).toEqual({
      status: "restored",
      catalogId: Q3.id,
    });
  });

  it("discards a stored id that is not in this organization's catalogs", () => {
    // e.g. a catalog belonging to another organization, or since deleted
    expect(resolveActiveCatalog([SANDBOX, Q3], "cat-from-other-org")).toEqual({
      status: "needs-selection",
      catalogId: null,
    });
  });

  it("discards an empty stored id", () => {
    expect(resolveActiveCatalog([SANDBOX, Q3], "")).toEqual({
      status: "needs-selection",
      catalogId: null,
    });
  });
});

describe("per-organization persistence", () => {
  beforeEach(() => {
    installStorage();
  });

  it("scopes the storage key by organization", () => {
    expect(catalogStorageKey(ORG_A)).toBe("data-kitchen:selected-catalog:org-aaaa");
    expect(catalogStorageKey(ORG_A)).not.toBe(catalogStorageKey(ORG_B));
  });

  it("round-trips a selection", () => {
    writeStoredCatalogId(ORG_A, Q3.id);
    expect(readStoredCatalogId(ORG_A)).toBe(Q3.id);
  });

  it("keeps organizations independent", () => {
    writeStoredCatalogId(ORG_A, Q3.id);
    writeStoredCatalogId(ORG_B, SANDBOX.id);
    expect(readStoredCatalogId(ORG_A)).toBe(Q3.id);
    expect(readStoredCatalogId(ORG_B)).toBe(SANDBOX.id);
  });

  it("returns null for an organization with no stored selection", () => {
    writeStoredCatalogId(ORG_A, Q3.id);
    expect(readStoredCatalogId(ORG_B)).toBeNull();
  });

  it("clears only the requested organization", () => {
    writeStoredCatalogId(ORG_A, Q3.id);
    writeStoredCatalogId(ORG_B, SANDBOX.id);
    clearStoredCatalogId(ORG_A);
    expect(readStoredCatalogId(ORG_A)).toBeNull();
    expect(readStoredCatalogId(ORG_B)).toBe(SANDBOX.id);
  });

  it("is a no-op when no organization is active", () => {
    expect(readStoredCatalogId(null)).toBeNull();
    expect(() => writeStoredCatalogId(null, Q3.id)).not.toThrow();
    expect(() => clearStoredCatalogId(null)).not.toThrow();
  });
});

describe("organization switch changes catalog context", () => {
  beforeEach(() => {
    installStorage();
  });

  it("does not carry Org A's catalog into Org B", () => {
    writeStoredCatalogId(ORG_A, Q3.id);

    // Org B has its own catalogs; Org A's stored id is not among them.
    const orgBCatalogs: CatalogSummary[] = [
      { id: "cat-nw-sandbox", name: "Import Sandbox", catalogType: "test" },
      { id: "cat-nw-q3", name: "Q3 Product Feed", catalogType: "production" },
    ];

    const result = resolveActiveCatalog(orgBCatalogs, readStoredCatalogId(ORG_B));
    expect(result).toEqual({ status: "needs-selection", catalogId: null });
  });

  it("restores each organization's own prior selection", () => {
    writeStoredCatalogId(ORG_A, Q3.id);
    writeStoredCatalogId(ORG_B, "cat-nw-q3");

    const orgBCatalogs: CatalogSummary[] = [
      { id: "cat-nw-sandbox", name: "Import Sandbox" },
      { id: "cat-nw-q3", name: "Q3 Product Feed" },
    ];

    expect(resolveActiveCatalog([SANDBOX, Q3], readStoredCatalogId(ORG_A)).catalogId).toBe(Q3.id);
    expect(resolveActiveCatalog(orgBCatalogs, readStoredCatalogId(ORG_B)).catalogId).toBe("cat-nw-q3");
  });

  it("refuses a cross-organization catalog id even if somehow supplied", () => {
    // Org A's catalog id offered against Org B's catalog list.
    const orgBCatalogs: CatalogSummary[] = [{ id: "cat-nw-sandbox", name: "Import Sandbox" }, { id: "cat-nw-q3", name: "Q3" }];
    expect(resolveActiveCatalog(orgBCatalogs, Q3.id).catalogId).toBeNull();
  });
});

describe("catalog type labelling", () => {
  it("labels known types", () => {
    expect(catalogTypeLabel("production")).toBe("Production");
    expect(catalogTypeLabel("test")).toBe("Test");
    expect(catalogTypeLabel("sandbox")).toBe("Sandbox");
  });

  it("labels unknown types as Other", () => {
    expect(catalogTypeLabel("staging")).toBe("Other");
  });

  it("returns null when there is no type", () => {
    expect(catalogTypeLabel(undefined)).toBeNull();
    expect(catalogTypeLabel("")).toBeNull();
    expect(catalogTypeLabel("   ")).toBeNull();
  });

  it("flags production catalogs", () => {
    expect(isProductionCatalog("production")).toBe(true);
    expect(isProductionCatalog("PRODUCTION")).toBe(true);
    expect(isProductionCatalog("test")).toBe(false);
    expect(isProductionCatalog(undefined)).toBe(false);
  });
});
