import { describe, it, expect } from "vitest";
import { validateGtin, isValidGtinCheckDigit, requiresReview } from "../../src/services/import-validation.js";

// Real GS1-valid values (check digit verified by the mod-10 algorithm).
const VALID_UPC12 = "012345678905";
const VALID_EAN13 = "0012345678905";
const VALID_GTIN14 = "00012345678905";

describe("isValidGtinCheckDigit", () => {
  it("accepts valid GTINs at each supported length", () => {
    expect(isValidGtinCheckDigit(VALID_UPC12)).toBe(true);
    expect(isValidGtinCheckDigit(VALID_EAN13)).toBe(true);
    expect(isValidGtinCheckDigit(VALID_GTIN14)).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    // Same payload as VALID_UPC12 but check digit 6 instead of 5.
    expect(isValidGtinCheckDigit("012345678906")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(isValidGtinCheckDigit("ABC123INVALID")).toBe(false);
  });
});

describe("validateGtin", () => {
  it("passes a valid GTIN with no issues", () => {
    expect(validateGtin(VALID_GTIN14)).toEqual([]);
    expect(validateGtin(VALID_UPC12, "upc")).toEqual([]);
  });

  it("warns when the GTIN is missing", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const issues = validateGtin(empty);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe("GTIN_MISSING");
      expect(issues[0].severity).toBe("warning");
    }
  });

  it("warns on the KI-2 value rather than accepting it silently", () => {
    const issues = validateGtin("ABC123INVALID");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("GTIN_NON_NUMERIC");
    expect(issues[0].value).toBe("ABC123INVALID");
    expect(issues[0].message).toContain("ABC123INVALID");
  });

  it("warns on an unsupported digit length", () => {
    const issues = validateGtin("12345");
    expect(issues[0].code).toBe("GTIN_INVALID_LENGTH");
  });

  it("warns when a UPC column is not 12 digits", () => {
    const issues = validateGtin(VALID_GTIN14, "upc");
    expect(issues[0].code).toBe("UPC_INVALID_LENGTH");
    expect(issues[0].message).toContain("12");
  });

  it("treats upc-like column names as UPC", () => {
    expect(validateGtin("1234567890123", "UPC_Code")[0].code).toBe("UPC_INVALID_LENGTH");
    expect(validateGtin("1234567890123", "item_upc")[0].code).toBe("UPC_INVALID_LENGTH");
  });

  it("does not apply the UPC length rule to a generic gtin column", () => {
    expect(validateGtin(VALID_GTIN14, "gtin")).toEqual([]);
  });

  it("warns on a bad check digit", () => {
    const issues = validateGtin("00012345678900");
    expect(issues[0].code).toBe("GTIN_INVALID_CHECK_DIGIT");
  });

  it("never returns a blocking severity", () => {
    const all = [
      ...validateGtin(null),
      ...validateGtin("ABC123INVALID"),
      ...validateGtin("12345"),
      ...validateGtin("00012345678900"),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const i of all) expect(i.severity).toBe("warning");
  });

  it("flags a product for review when any issue is present", () => {
    expect(requiresReview(validateGtin("ABC123INVALID"))).toBe(true);
    expect(requiresReview(validateGtin(VALID_GTIN14))).toBe(false);
  });
});
