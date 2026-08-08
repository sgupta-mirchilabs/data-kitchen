/**
 * Lightweight import-time validation.
 *
 * Deliberately narrow: product identifiers only. This is NOT the Validation
 * Engine (a later phase) — there are no configurable rules, no per-retailer
 * requirements, and no blocking behaviour.
 *
 * Every issue is a warning. A row with an invalid identifier still imports and
 * still creates a product; it is flagged `needs_review` so an operator can see
 * it rather than having it silently accepted (KI-2).
 */

export type ValidationCode =
  | "GTIN_MISSING"
  | "GTIN_NON_NUMERIC"
  | "GTIN_INVALID_LENGTH"
  | "GTIN_INVALID_CHECK_DIGIT"
  | "UPC_INVALID_LENGTH";

export interface ValidationIssue {
  code: ValidationCode;
  /** Always "warning" in this phase — validation never fails a row. */
  severity: "warning";
  field: string;
  message: string;
  /** The offending value, echoed so an operator can find it in the source file. */
  value?: string;
}

/** GTIN-8, UPC-A (12), EAN-13, and GTIN-14 are the accepted lengths. */
const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** Source columns named like a UPC are held to the 12-digit UPC-A length. */
function looksLikeUpcField(sourceField?: string): boolean {
  const f = (sourceField ?? "").trim().toLowerCase();
  return f === "upc" || f.startsWith("upc_") || f.startsWith("upc ") || f.endsWith("_upc");
}

/**
 * Standard GS1 mod-10 check digit.
 *
 * Right-align the payload, weight digits 3 and 1 alternating from the rightmost
 * payload digit, then the check digit is (10 - sum % 10) % 10.
 */
export function isValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const payload = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  // Weight alternates 3,1,3,1… starting from the rightmost payload digit.
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Validates the GTIN captured for a product.
 *
 * `sourceField` is the original column name, used only to phrase UPC-specific
 * messages accurately.
 */
export function validateGtin(
  raw: string | null | undefined,
  sourceField?: string,
): ValidationIssue[] {
  const value = (raw ?? "").trim();

  if (!value) {
    return [{
      code: "GTIN_MISSING",
      severity: "warning",
      field: "gtin",
      message: "No GTIN provided. Retailer submissions normally require a GTIN.",
    }];
  }

  if (!/^\d+$/.test(value)) {
    return [{
      code: "GTIN_NON_NUMERIC",
      severity: "warning",
      field: "gtin",
      value,
      message: `GTIN "${value}" is not numeric. Expected 8, 12, 13, or 14 digits.`,
    }];
  }

  if (looksLikeUpcField(sourceField) && value.length !== 12) {
    return [{
      code: "UPC_INVALID_LENGTH",
      severity: "warning",
      field: "gtin",
      value,
      message: `UPC "${value}" has ${value.length} digits. UPC-A requires exactly 12.`,
    }];
  }

  if (!VALID_GTIN_LENGTHS.has(value.length)) {
    return [{
      code: "GTIN_INVALID_LENGTH",
      severity: "warning",
      field: "gtin",
      value,
      message: `GTIN "${value}" has ${value.length} digits. Expected 8, 12, 13, or 14.`,
    }];
  }

  if (!isValidGtinCheckDigit(value)) {
    return [{
      code: "GTIN_INVALID_CHECK_DIGIT",
      severity: "warning",
      field: "gtin",
      value,
      message: `GTIN "${value}" fails its check digit. The value may be mistyped.`,
    }];
  }

  return [];
}

/** True when any issue should push the product to `needs_review`. */
export function requiresReview(issues: ValidationIssue[]): boolean {
  return issues.length > 0;
}
