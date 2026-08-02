import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, detectDelimiter } from "../../src/services/parser/csv-parser.js";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");

describe("detectDelimiter", () => {
  it("detects comma delimiter", () => {
    expect(detectDelimiter("SKU,Name,Brand\na,b,c")).toBe(",");
  });

  it("detects tab delimiter", () => {
    expect(detectDelimiter("SKU\tName\tBrand\na\tb\tc")).toBe("\t");
  });

  it("defaults to comma when no delimiters found", () => {
    expect(detectDelimiter("single_column")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses the sample CSV fixture", () => {
    const content = readFileSync(join(fixturesDir, "sample-products.csv"), "utf-8");
    const result = parseCsv(content);

    expect(result.headers).toContain("SKU");
    expect(result.headers).toContain("Product Name");
    expect(result.headers).toContain("Brand");
    expect(result.headers).toContain("GTIN");
    expect(result.rows.length).toBe(6);
    expect(result.rows[0].data["SKU"]).toBe("NF-JKT-APEX-M-BLK");
    expect(result.rows[0].data["Brand"]).toBe("The North Face");
    expect(result.metadata.delimiter).toBe("comma");
    expect(result.metadata.totalRows).toBe(6);
  });

  it("handles quoted values with commas", () => {
    const csv = 'Name,Desc\n"Widget, Deluxe","A fancy, nice widget"';
    const result = parseCsv(csv);

    expect(result.rows[0].data["Name"]).toBe("Widget, Deluxe");
    expect(result.rows[0].data["Desc"]).toBe("A fancy, nice widget");
  });

  it("detects duplicate headers", () => {
    const csv = "SKU,Name,Name,Brand\na,b,c,d";
    const result = parseCsv(csv);

    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].type).toBe("duplicate_header");
    expect(result.warnings[0].column).toBe("name");
  });

  it("handles empty cells", () => {
    const csv = "SKU,Name,Brand\nabc,,TestBrand";
    const result = parseCsv(csv);

    expect(result.rows[0].data["Name"]).toBe("");
    expect(result.rows[0].data["Brand"]).toBe("TestBrand");
  });

  it("warns on empty rows", () => {
    const csv = "SKU,Name\nabc,Test\n,,\ndef,Test2";
    const result = parseCsv(csv);

    expect(result.rows.length).toBe(2);
    expect(result.warnings.some((w) => w.type === "empty_row")).toBe(true);
  });

  it("warns on column count mismatch", () => {
    const csv = "SKU,Name,Brand\nabc,Test";
    const result = parseCsv(csv);

    expect(result.warnings.some((w) => w.type === "column_count_mismatch")).toBe(true);
  });

  it("throws on empty file", () => {
    expect(() => parseCsv("")).toThrow("File is empty");
  });

  it("throws on header-only file", () => {
    expect(() => parseCsv("SKU,Name,Brand\n")).toThrow("no valid data rows");
  });

  it("respects maxRows limit", () => {
    const csv = "SKU\na\nb\nc\nd\ne";
    const result = parseCsv(csv, 3);

    expect(result.rows.length).toBe(3);
    expect(result.metadata.totalRows).toBe(5);
  });

  it("parses tab-delimited content", () => {
    const csv = "SKU\tName\tBrand\nabc\tWidget\tAcme";
    const result = parseCsv(csv);

    expect(result.metadata.delimiter).toBe("tab");
    expect(result.rows[0].data["SKU"]).toBe("abc");
  });
});
