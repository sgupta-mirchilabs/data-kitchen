/**
 * Raised when a file carries more rows than the configured limit.
 *
 * Previously both parsers silently truncated with `Math.min(rows, maxRows)`, so
 * an operator importing 12,000 rows against a 10,000 limit saw a successful
 * import and never learned that 2,000 rows were discarded. Refusing the file is
 * the only honest option: a partial import is indistinguishable from a complete
 * one once it lands in the catalog.
 */
export class RowLimitExceededError extends Error {
  readonly statusCode = 413;
  readonly code = "IMPORT_ROW_LIMIT_EXCEEDED";
  constructor(readonly rowCount: number, readonly maxRows: number) {
    super(
      `This file contains ${rowCount.toLocaleString()} rows, which exceeds the limit of ${maxRows.toLocaleString()}. ` +
      `No rows were imported. Split the file and import it in parts, or ask an administrator to raise MAX_IMPORT_ROWS.`,
    );
    this.name = "RowLimitExceededError";
  }
}
