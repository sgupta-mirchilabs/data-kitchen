import { describe, it, expect } from "vitest";
import {
  detectDuplicateSkus,
  countOverwrittenRows,
  describeDuplicateGroup,
} from "../../src/services/duplicate-detection.js";

const row = (rowNumber: number, sku: string, extra: Record<string, string> = {}) => ({
  rowNumber,
  data: { sku, ...extra },
});

describe("detectDuplicateSkus", () => {
  it("returns nothing when every SKU is unique", () => {
    expect(detectDuplicateSkus([row(1, "A"), row(2, "B"), row(3, "C")], "sku")).toEqual([]);
  });

  it("detects the KI-3 case from the real test file", () => {
    // Import 08.07 1.txt carried SG-HDPH-WHT on rows 2 and 5.
    const groups = detectDuplicateSkus(
      [
        row(1, "NF-APEX-M-BLK"),
        row(2, "SG-HDPH-WHT"),
        row(3, "GD-FERT-5LB"),
        row(4, "PT-PAINT-NVY-1GAL"),
        row(5, "SG-HDPH-WHT"),
      ],
      "sku",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      sku: "SG-HDPH-WHT",
      occurrences: 2,
      rowNumbers: [2, 5],
      winningRow: 5,
      overwrittenRows: [2],
    });
  });

  it("orders row numbers ascending regardless of input order", () => {
    const groups = detectDuplicateSkus([row(9, "A"), row(2, "A"), row(5, "A")], "sku");
    expect(groups[0].rowNumbers).toEqual([2, 5, 9]);
    expect(groups[0].winningRow).toBe(9);
    expect(groups[0].overwrittenRows).toEqual([2, 5]);
  });

  it("trims values so trailing whitespace is not treated as a distinct SKU", () => {
    const groups = detectDuplicateSkus([row(1, "ABC"), row(2, "ABC  ")], "sku");
    expect(groups).toHaveLength(1);
    expect(groups[0].sku).toBe("ABC");
  });

  it("is case-sensitive, matching the resolver's exact-match lookup", () => {
    expect(detectDuplicateSkus([row(1, "abc"), row(2, "ABC")], "sku")).toEqual([]);
  });

  it("ignores rows with a blank SKU", () => {
    expect(detectDuplicateSkus([row(1, ""), row(2, "   "), row(3, "A")], "sku")).toEqual([]);
  });

  it("returns nothing when no SKU column is mapped", () => {
    expect(detectDuplicateSkus([row(1, "A"), row(2, "A")], undefined)).toEqual([]);
  });

  it("reads the mapped header, not a hardcoded field name", () => {
    const rows = [
      { rowNumber: 1, data: { item_sku: "X" } },
      { rowNumber: 2, data: { item_sku: "X" } },
    ];
    expect(detectDuplicateSkus(rows, "item_sku")).toHaveLength(1);
    expect(detectDuplicateSkus(rows, "sku")).toEqual([]);
  });

  it("reports several duplicate groups, most repeated first", () => {
    const groups = detectDuplicateSkus(
      [row(1, "A"), row(2, "B"), row(3, "A"), row(4, "B"), row(5, "A")],
      "sku",
    );
    expect(groups.map((g) => g.sku)).toEqual(["A", "B"]);
    expect(groups[0].occurrences).toBe(3);
  });

  it("counts total overwritten rows", () => {
    const groups = detectDuplicateSkus(
      [row(1, "A"), row(2, "A"), row(3, "A"), row(4, "B"), row(5, "B")],
      "sku",
    );
    expect(countOverwrittenRows(groups)).toBe(3); // 2 from A + 1 from B
  });

  it("describes the outcome in operator terms", () => {
    const [group] = detectDuplicateSkus([row(2, "SG-HDPH-WHT"), row(5, "SG-HDPH-WHT")], "sku");
    const text = describeDuplicateGroup(group);
    expect(text).toContain("SG-HDPH-WHT");
    expect(text).toContain("2 times");
    expect(text).toContain("rows 2, 5");
    expect(text).toContain("Row 5 will overwrite");
  });
});
