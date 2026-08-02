import type { ParseResult, ParseWarning, ParsedRow, ParseMetadata } from "./parser.types.js";
import { ParseError } from "../../errors/api-errors.js";

function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseJson(content: string, maxRows?: number): ParseResult {
  const warnings: ParseWarning[] = [];

  if (!content.trim()) {
    throw new ParseError("File is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ParseError("Invalid JSON", {
      originalError: err instanceof Error ? err.message : String(err),
    });
  }

  let items: unknown[];
  let jsonStructure: "array" | "object_with_products";

  if (Array.isArray(parsed)) {
    items = parsed;
    jsonStructure = "array";
  } else if (
    parsed !== null &&
    typeof parsed === "object" &&
    "products" in parsed &&
    Array.isArray((parsed as Record<string, unknown>).products)
  ) {
    items = (parsed as Record<string, unknown>).products as unknown[];
    jsonStructure = "object_with_products";
  } else {
    throw new ParseError(
      "Unsupported JSON structure. Expected an array of objects or an object with a \"products\" array.",
      { receivedType: typeof parsed, isArray: Array.isArray(parsed) },
    );
  }

  if (items.length === 0) {
    throw new ParseError("JSON contains no product records");
  }

  const nonObjects = items.filter((item) => typeof item !== "object" || item === null || Array.isArray(item));
  if (nonObjects.length > 0) {
    warnings.push({
      message: `${nonObjects.length} item(s) are not plain objects and will be skipped`,
      type: "structure",
    });
  }

  const validItems = items.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );

  const headerSet = new Set<string>();
  for (const item of validItems) {
    for (const key of Object.keys(item)) {
      headerSet.add(key);
    }
  }
  const headers = Array.from(headerSet);

  const limit = maxRows ? Math.min(validItems.length, maxRows) : validItems.length;

  const rows: ParsedRow[] = [];
  for (let i = 0; i < limit; i++) {
    const item = validItems[i];
    const data: Record<string, string> = {};
    for (const key of headers) {
      data[key] = flattenValue(item[key]);
    }
    rows.push({ rowNumber: i + 1, data });
  }

  const metadata: ParseMetadata = {
    encoding: "utf-8",
    totalRows: validItems.length,
    jsonStructure,
  };

  return { headers, rows, warnings, metadata };
}
