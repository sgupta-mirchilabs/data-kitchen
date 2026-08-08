import { parse } from "csv-parse/sync";
import type { ParseResult, ParseWarning, ParsedRow, ParseMetadata } from "./parser.types.js";
import { ParseError } from "../../errors/api-errors.js";
import { RowLimitExceededError } from "./row-limit.js";

export function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function findDuplicateHeaders(headers: string[]): Array<{ header: string; positions: number[] }> {
  const seen = new Map<string, number[]>();
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].trim().toLowerCase();
    if (!normalized) continue;
    const positions = seen.get(normalized) ?? [];
    positions.push(i);
    seen.set(normalized, positions);
  }
  return Array.from(seen.entries())
    .filter(([, positions]) => positions.length > 1)
    .map(([header, positions]) => ({ header, positions }));
}

export function parseCsv(content: string, maxRows?: number): ParseResult {
  const warnings: ParseWarning[] = [];

  if (!content.trim()) {
    throw new ParseError("File is empty");
  }

  const delimiter = detectDelimiter(content);

  let records: string[][];
  try {
    records = parse(content, {
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      bom: true,
    });
  } catch (err) {
    throw new ParseError("Failed to parse CSV", {
      originalError: err instanceof Error ? err.message : String(err),
    });
  }

  if (records.length === 0) {
    throw new ParseError("File contains no data rows");
  }

  const headers = records[0].map((h) => h.trim());

  const duplicates = findDuplicateHeaders(headers);
  for (const dup of duplicates) {
    warnings.push({
      column: dup.header,
      message: `Duplicate header "${dup.header}" at positions ${dup.positions.join(", ")}`,
      type: "duplicate_header",
    });
  }

  const dataRecords = records.slice(1);
  // Refuse rather than truncate — a silently partial import is
  // indistinguishable from a complete one once committed.
  if (maxRows && dataRecords.length > maxRows) {
    throw new RowLimitExceededError(dataRecords.length, maxRows);
  }
  const limit = dataRecords.length;

  const rows: ParsedRow[] = [];
  for (let i = 0; i < limit; i++) {
    const record = dataRecords[i];
    if (record.every((cell) => cell.trim() === "")) {
      warnings.push({
        rowNumber: i + 1,
        message: `Row ${i + 1} is empty`,
        type: "empty_row",
      });
      continue;
    }

    if (record.length !== headers.length) {
      warnings.push({
        rowNumber: i + 1,
        message: `Row ${i + 1} has ${record.length} columns, expected ${headers.length}`,
        type: "column_count_mismatch",
      });
    }

    const data: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] || `_column_${j}`;
      data[key] = (record[j] ?? "").trim();
    }
    rows.push({ rowNumber: i + 1, data });
  }

  if (rows.length === 0) {
    throw new ParseError("File contains no valid data rows after parsing");
  }

  const metadata: ParseMetadata = {
    delimiter: delimiter === "\t" ? "tab" : "comma",
    encoding: "utf-8",
    totalRows: dataRecords.length,
    jsonStructure: null,
  };

  return { headers, rows, warnings, metadata };
}
