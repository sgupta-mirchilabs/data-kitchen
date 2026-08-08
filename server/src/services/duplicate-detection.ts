/**
 * In-file duplicate detection for the import preview (KI-3).
 *
 * The import pipeline already resolves repeated business keys as last-write-wins.
 * That behaviour is unchanged here — this module exists purely so the operator is
 * told what will happen before confirming, instead of discovering afterwards that
 * an earlier row was silently overwritten.
 */

export interface ParsedRowLike {
  rowNumber: number;
  data: Record<string, string>;
}

export interface DuplicateGroup {
  /** The repeated business key, as it appears after trimming. */
  sku: string;
  /** Every row carrying this key, in file order. */
  rowNumbers: number[];
  occurrences: number;
  /** The row whose values survive — the last occurrence. */
  winningRow: number;
  /** Rows that will be overwritten by a later row in the same file. */
  overwrittenRows: number[];
}

/**
 * Groups rows by their mapped SKU value and returns only the keys that appear
 * more than once.
 *
 * Values are trimmed to match the normalizer, which trims before comparison —
 * otherwise "ABC" and "ABC " would look distinct here but collide downstream.
 * Comparison is case-sensitive, matching `findDuplicate`'s exact-match lookup.
 */
export function detectDuplicateSkus(
  rows: ParsedRowLike[],
  skuHeader: string | undefined,
): DuplicateGroup[] {
  if (!skuHeader) return [];

  const bySku = new Map<string, number[]>();

  for (const row of rows) {
    const raw = row.data?.[skuHeader];
    const sku = typeof raw === "string" ? raw.trim() : "";
    if (!sku) continue; // rows without a key cannot collide on one
    const existing = bySku.get(sku);
    if (existing) existing.push(row.rowNumber);
    else bySku.set(sku, [row.rowNumber]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [sku, rowNumbers] of bySku) {
    if (rowNumbers.length < 2) continue;
    const ordered = [...rowNumbers].sort((a, b) => a - b);
    groups.push({
      sku,
      rowNumbers: ordered,
      occurrences: ordered.length,
      winningRow: ordered[ordered.length - 1],
      overwrittenRows: ordered.slice(0, -1),
    });
  }

  // Most-repeated first, then by first appearance, so the worst cases lead.
  return groups.sort(
    (a, b) => b.occurrences - a.occurrences || a.rowNumbers[0] - b.rowNumbers[0],
  );
}

/** Total rows that will be superseded by a later row in the same file. */
export function countOverwrittenRows(groups: DuplicateGroup[]): number {
  return groups.reduce((n, g) => n + g.overwrittenRows.length, 0);
}

/** Operator-facing summary, e.g. "SKU SG-HDPH-WHT appears 2 times." */
export function describeDuplicateGroup(group: DuplicateGroup): string {
  return `SKU ${group.sku} appears ${group.occurrences} times (rows ${group.rowNumbers.join(", ")}). Row ${group.winningRow} will overwrite the earlier rows.`;
}
