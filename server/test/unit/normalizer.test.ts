import { describe, it, expect } from "vitest";
import {
  suggestFieldMappings,
  normalizeRow,
  computeDataQualityStatus,
} from "../../src/services/normalizer.js";

describe("suggestFieldMappings", () => {
  it("maps common header names to canonical fields", () => {
    const headers = ["SKU", "Product Name", "Brand", "GTIN", "Category"];
    const result = suggestFieldMappings(headers);

    expect(result.sku).toBe("SKU");
    expect(result.product_name).toBe("Product Name");
    expect(result.brand).toBe("Brand");
    expect(result.gtin).toBe("GTIN");
    expect(result.category).toBe("Category");
  });

  it("handles aliases like UPC → gtin", () => {
    const result = suggestFieldMappings(["Item SKU", "UPC", "Vendor"]);
    expect(result.sku).toBe("Item SKU");
    expect(result.gtin).toBe("UPC");
  });

  it("handles case insensitive matching", () => {
    const result = suggestFieldMappings(["sku", "PRODUCT NAME", "brand"]);
    expect(result.sku).toBe("sku");
    expect(result.product_name).toBe("PRODUCT NAME");
    expect(result.brand).toBe("brand");
  });

  it("returns empty mappings for unknown headers", () => {
    const result = suggestFieldMappings(["foo", "bar", "baz"]);
    expect(result.sku).toBeUndefined();
    expect(result.product_name).toBeUndefined();
  });
});

describe("normalizeRow", () => {
  it("extracts core fields and puts remaining in attributes", () => {
    const row = {
      SKU: "ABC-123",
      "Product Name": "Widget",
      Brand: "Acme",
      GTIN: "00012345678901",
      Category: "Tools",
      Color: "Red",
      Weight: "5 lbs",
    };
    const mappings = { sku: "SKU", product_name: "Product Name", brand: "Brand", gtin: "GTIN", category: "Category" };
    const result = normalizeRow(row, mappings);

    expect(result.product.sku).toBe("ABC-123");
    expect(result.product.productName).toBe("Widget");
    expect(result.product.brand).toBe("Acme");
    expect(result.product.category).toBe("Tools");
    expect(result.product.attributes).toEqual({ Color: "Red", Weight: "5 lbs" });
  });

  it("normalizes GTIN by padding to 14 digits", () => {
    const row = { UPC: "12345678901" };
    const mappings = { gtin: "UPC" };
    const result = normalizeRow(row, mappings);

    expect(result.product.gtin).toBe("00012345678901");
    expect(result.provenance.find((p) => p.canonicalField === "gtin")?.normalizationMethod).toBe("padded_to_gtin14");
  });

  it("treats empty strings as null", () => {
    const row = { SKU: "", Name: "  ", Brand: "Acme" };
    const mappings = { sku: "SKU", product_name: "Name", brand: "Brand" };
    const result = normalizeRow(row, mappings);

    expect(result.product.sku).toBeNull();
    expect(result.product.productName).toBeNull();
    expect(result.product.brand).toBe("Acme");
  });

  it("creates provenance entries for mapped fields", () => {
    const row = { SKU: "ABC", Name: "Widget" };
    const mappings = { sku: "SKU", product_name: "Name" };
    const result = normalizeRow(row, mappings);

    expect(result.provenance.length).toBe(2);
    expect(result.provenance.find((p) => p.canonicalField === "sku")?.sourceField).toBe("SKU");
    expect(result.provenance.find((p) => p.canonicalField === "product_name")?.sourceField).toBe("Name");
  });
});

describe("computeDataQualityStatus", () => {
  it("returns complete when all core fields present", () => {
    const status = computeDataQualityStatus({
      sku: "ABC", gtin: null, brand: "Acme", productName: "Widget",
      shortDescription: null, longDescription: null, category: "Tools",
      manufacturer: null, attributes: {},
    });
    expect(status).toBe("complete");
  });

  it("returns missing_core_fields when sku is null", () => {
    const status = computeDataQualityStatus({
      sku: null, gtin: null, brand: "Acme", productName: "Widget",
      shortDescription: null, longDescription: null, category: "Tools",
      manufacturer: null, attributes: {},
    });
    expect(status).toBe("missing_core_fields");
  });

  it("returns missing_core_fields when product_name is null", () => {
    const status = computeDataQualityStatus({
      sku: "ABC", gtin: null, brand: "Acme", productName: null,
      shortDescription: null, longDescription: null, category: "Tools",
      manufacturer: null, attributes: {},
    });
    expect(status).toBe("missing_core_fields");
  });
});
