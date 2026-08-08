import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  computeHeaderFingerprint,
  matchTemplate,
  nextVersion,
  type StoredTemplate,
} from "../../src/services/mapping-template.js";

const ORG = "org-1";

const HEADERS = ["sku", "gtin", "brand", "title", "category", "description"];

const template = (over: Partial<StoredTemplate> = {}): StoredTemplate => ({
  id: "tpl-1",
  organizationId: ORG,
  sourceType: "csv",
  headerFingerprint: computeHeaderFingerprint(HEADERS),
  headers: HEADERS,
  mappings: {
    sku: "sku",
    gtin: "gtin",
    brand: "brand",
    product_name: "title",
    category: "category",
    long_description: "description",
  },
  version: 1,
  ...over,
});

describe("normalizeHeader", () => {
  it("makes spacing, casing and punctuation irrelevant", () => {
    expect(normalizeHeader("Product Name")).toBe("product_name");
    expect(normalizeHeader("product-name")).toBe("product_name");
    expect(normalizeHeader("  PRODUCT_NAME  ")).toBe("product_name");
  });
});

describe("computeHeaderFingerprint", () => {
  it("is stable for the same header set", () => {
    expect(computeHeaderFingerprint(HEADERS)).toBe(computeHeaderFingerprint([...HEADERS]));
  });

  it("ignores column order", () => {
    expect(computeHeaderFingerprint(HEADERS)).toBe(
      computeHeaderFingerprint([...HEADERS].reverse()),
    );
  });

  it("ignores casing and separator style", () => {
    expect(computeHeaderFingerprint(["Product Name", "SKU"])).toBe(
      computeHeaderFingerprint(["product_name", "sku"]),
    );
  });

  it("changes when a column is added or removed", () => {
    expect(computeHeaderFingerprint(HEADERS)).not.toBe(
      computeHeaderFingerprint([...HEADERS, "color"]),
    );
    expect(computeHeaderFingerprint(HEADERS)).not.toBe(
      computeHeaderFingerprint(HEADERS.slice(1)),
    );
  });
});

describe("matchTemplate — exact", () => {
  it("applies the whole mapping when headers match", () => {
    const m = matchTemplate(HEADERS, "csv", [template()]);
    expect(m.kind).toBe("exact");
    expect(m.coverage).toBe(1);
    expect(m.newHeaders).toEqual([]);
    expect(m.appliedMappings.product_name).toBe("title");
  });

  it("matches despite reordered and re-cased columns, re-pointing to actual spellings", () => {
    const uploaded = ["Category", "Description", "Title", "Brand", "GTIN", "SKU"];
    const m = matchTemplate(uploaded, "csv", [template()]);
    expect(m.kind).toBe("exact");
    // Mapping values must be this file's real header strings, not the stored ones.
    expect(m.appliedMappings.product_name).toBe("Title");
    expect(m.appliedMappings.sku).toBe("SKU");
  });

  it("prefers the highest version on an exact match", () => {
    const v2 = template({ id: "tpl-2", version: 2, mappings: { sku: "sku" } });
    const m = matchTemplate(HEADERS, "csv", [template(), v2]);
    expect(m.template?.id).toBe("tpl-2");
  });

  it("does not match a template saved for a different source type", () => {
    expect(matchTemplate(HEADERS, "json", [template()]).kind).toBe("none");
  });
});

describe("matchTemplate — partial", () => {
  it("pre-applies known columns and reports only the new one", () => {
    const uploaded = [...HEADERS, "color"];
    const m = matchTemplate(uploaded, "csv", [template()]);
    expect(m.kind).toBe("partial");
    expect(m.newHeaders).toEqual(["color"]);
    // Every previously mapped column is still resolved — no re-mapping needed.
    expect(Object.keys(m.appliedMappings).sort()).toEqual(
      ["brand", "category", "gtin", "long_description", "product_name", "sku"],
    );
    expect(m.coverage).toBe(1);
  });

  it("reports a mapped column that disappeared", () => {
    const uploaded = HEADERS.filter((h) => h !== "description");
    const m = matchTemplate(uploaded, "csv", [template()]);
    expect(m.kind).toBe("partial");
    expect(m.missingHeaders).toEqual(["description"]);
    expect(m.appliedMappings.long_description).toBeUndefined();
    expect(m.appliedMappings.sku).toBe("sku");
    expect(m.coverage).toBeCloseTo(5 / 6);
  });

  it("prefers the candidate with the highest coverage", () => {
    const narrow = template({ id: "narrow", headerFingerprint: "x", mappings: { sku: "sku" }, headers: ["sku"] });
    const uploaded = [...HEADERS, "color"];
    const m = matchTemplate(uploaded, "csv", [narrow, template()]);
    expect(m.template?.id).toBe("tpl-1");
  });

  it("returns none when nothing in common", () => {
    const m = matchTemplate(["alpha", "beta"], "csv", [template()]);
    expect(m.kind).toBe("none");
    expect(m.appliedMappings).toEqual({});
  });

  it("returns none when there are no candidates", () => {
    const m = matchTemplate(HEADERS, "csv", []);
    expect(m.kind).toBe("none");
    expect(m.newHeaders).toEqual(HEADERS);
  });
});

describe("nextVersion", () => {
  it("starts at 1 and increments past the highest existing version", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([template({ version: 1 }), template({ version: 4 })])).toBe(5);
  });
});
