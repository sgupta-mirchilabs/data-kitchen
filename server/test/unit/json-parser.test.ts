import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "../../src/services/parser/json-parser.js";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");

describe("parseJson", () => {
  it("parses a JSON array", () => {
    const content = readFileSync(join(fixturesDir, "sample-products.json"), "utf-8");
    const result = parseJson(content);

    expect(result.headers).toContain("SKU");
    expect(result.headers).toContain("Product Name");
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].data["SKU"]).toBe("NF-JKT-APEX-M-BLK");
    expect(result.metadata.jsonStructure).toBe("array");
    expect(result.metadata.totalRows).toBe(3);
  });

  it("parses { products: [...] } wrapper", () => {
    const content = readFileSync(join(fixturesDir, "sample-products-wrapped.json"), "utf-8");
    const result = parseJson(content);

    expect(result.rows.length).toBe(2);
    expect(result.metadata.jsonStructure).toBe("object_with_products");
  });

  it("collects all unique headers across items", () => {
    const json = JSON.stringify([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    const result = parseJson(json);

    expect(result.headers).toContain("a");
    expect(result.headers).toContain("b");
    expect(result.headers).toContain("c");
    expect(result.rows[0].data["c"]).toBe("");
    expect(result.rows[1].data["a"]).toBe("");
  });

  it("flattens nested objects to JSON strings", () => {
    const json = JSON.stringify([{ name: "Test", dimensions: { w: 10, h: 20 } }]);
    const result = parseJson(json);

    expect(result.rows[0].data["dimensions"]).toBe('{"w":10,"h":20}');
  });

  it("handles null values", () => {
    const json = JSON.stringify([{ name: "Test", brand: null }]);
    const result = parseJson(json);

    expect(result.rows[0].data["brand"]).toBe("");
  });

  it("throws on empty file", () => {
    expect(() => parseJson("")).toThrow("File is empty");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJson("{not valid json")).toThrow("Invalid JSON");
  });

  it("throws on unsupported structure (plain object without products key)", () => {
    expect(() => parseJson('{"name": "test"}')).toThrow("Unsupported JSON structure");
  });

  it("throws on empty array", () => {
    expect(() => parseJson("[]")).toThrow("no product records");
  });

  it("warns about non-object items", () => {
    const json = JSON.stringify([{ name: "Test" }, "not an object", 42]);
    const result = parseJson(json);

    expect(result.rows.length).toBe(1);
    expect(result.warnings.some((w) => w.type === "structure")).toBe(true);
  });

  it("respects maxRows limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = parseJson(JSON.stringify(items), 5);

    expect(result.rows.length).toBe(5);
    expect(result.metadata.totalRows).toBe(10);
  });
});
