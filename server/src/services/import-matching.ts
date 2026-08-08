import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeGtin } from "./normalizer.js";

/**
 * Authoritative import matching (Phase 1.0.2, Increment B).
 *
 * Before this module the same question — "which existing product does this row
 * describe?" — was answered in two places: `findDuplicate`, one query per row,
 * inside the commit pipeline; and `projectImportImpact`, one batched query, for
 * the preview. Two implementations of one rule is one implementation too many:
 * they had already drifted (the preview compared raw GTIN text against stored
 * GTIN-14, so a 12-digit GTIN previewed as a create and committed as an update).
 *
 * This is now the single definition. Both callers resolve through it, so the
 * preview cannot promise something the commit will not do.
 *
 * The rule, unchanged from `findDuplicate`:
 *   1. SKU, when the row has one, scoped to the catalog.
 *   2. GTIN, only if the SKU did not match.
 *   3. Nothing matched — the row creates a product.
 *
 * In-file behaviour is also unchanged, but is now explicit rather than emergent.
 * The serial pipeline got it for free: a product created by row 3 was in the
 * database by the time row 40 was matched, so row 40 updated it. Resolving a
 * whole chunk against one snapshot loses that, so rows created earlier in the
 * pass are registered in the index as they are resolved. Row 40 still lands on
 * row 3's product.
 */

/** A row reduced to the two identifiers matching cares about, already normalized. */
export interface MatchRow {
  rowNumber: number;
  /** Trimmed; empty becomes null. */
  sku: string | null;
  /** Exactly the value that would be persisted — GTIN-14 padded, not raw text. */
  gtin: string | null;
}

export interface MatchCandidate {
  id: string;
  sku: string | null;
  gtin: string | null;
  productName: string | null;
}

/**
 * The product a row resolves to.
 *
 * `new` means no product exists yet; `createIndex` is stable across the rows of
 * one resolution pass, so several rows describing one product agree on it
 * before any id has been assigned.
 */
export type ResolvedTarget =
  | { kind: "existing"; productId: string; productName: string | null }
  | { kind: "new"; createIndex: number };

export interface ResolvedRow {
  rowNumber: number;
  sku: string | null;
  gtin: string | null;
  target: ResolvedTarget;
  /** How the row reached its target; null when this row is the one creating it. */
  matchedOn: "sku" | "gtin" | null;
  /** True for the first row in the pass to resolve to this target. */
  first: boolean;
  /** The file value that matched, for operator-facing reporting. */
  matchedValue: string | null;
}

/**
 * Reduces an unmapped file row to its match identifiers.
 *
 * Applies exactly the normalization the commit pipeline applies — trim for SKU,
 * GTIN-14 padding for GTIN — so the preview asks the catalog the same question
 * the commit will ask.
 */
export function matchRowFromRaw(
  row: { rowNumber: number; data: Record<string, string> },
  skuHeader: string | undefined,
  gtinHeader: string | undefined,
): MatchRow {
  const read = (header: string | undefined): string | null => {
    if (!header) return null;
    const raw = row.data?.[header];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  };

  const rawGtin = read(gtinHeader);
  return {
    rowNumber: row.rowNumber,
    sku: read(skuHeader),
    gtin: rawGtin === null ? null : normalizeGtin(rawGtin).value,
  };
}

export function targetKey(target: ResolvedTarget): string {
  return target.kind === "existing" ? `p:${target.productId}` : `n:${target.createIndex}`;
}

/**
 * The matching rule itself — pure, so it can be tested without a database and
 * shared verbatim by preview and commit.
 *
 * `candidates` must already be scoped to the target catalog. Where two products
 * share a GTIN (no unique index constrains that) the first candidate wins, which
 * is the same arbitrary-but-stable choice `findFirst` made.
 */
export function resolveMatchesAgainst(
  candidates: MatchCandidate[],
  rows: MatchRow[],
): ResolvedRow[] {
  const bySku = new Map<string, ResolvedTarget>();
  const byGtin = new Map<string, ResolvedTarget>();

  for (const candidate of candidates) {
    const target: ResolvedTarget = {
      kind: "existing",
      productId: candidate.id,
      productName: candidate.productName,
    };
    if (candidate.sku && !bySku.has(candidate.sku)) bySku.set(candidate.sku, target);
    if (candidate.gtin && !byGtin.has(candidate.gtin)) byGtin.set(candidate.gtin, target);
  }

  const seen = new Set<string>();
  const resolved: ResolvedRow[] = [];
  let nextCreateIndex = 0;

  for (const row of rows) {
    let target: ResolvedTarget | null = null;
    let matchedOn: "sku" | "gtin" | null = null;
    let matchedValue: string | null = null;

    if (row.sku) {
      const hit = bySku.get(row.sku);
      if (hit) {
        target = hit;
        matchedOn = "sku";
        matchedValue = row.sku;
      }
    }
    // GTIN is a fallback, never an override: a row whose SKU matched never
    // reaches this branch.
    if (!target && row.gtin) {
      const hit = byGtin.get(row.gtin);
      if (hit) {
        target = hit;
        matchedOn = "gtin";
        matchedValue = row.gtin;
      }
    }

    if (!target) {
      target = { kind: "new", createIndex: nextCreateIndex++ };
      // Registering the pending product is what preserves in-file duplicate
      // behaviour: the serial pipeline found it in the database, this pass finds
      // it here. A row carrying neither identifier registers nothing and so
      // always creates, exactly as before.
      if (row.sku && !bySku.has(row.sku)) bySku.set(row.sku, target);
      if (row.gtin && !byGtin.has(row.gtin)) byGtin.set(row.gtin, target);
    }

    const key = targetKey(target);
    const first = !seen.has(key);
    if (first) seen.add(key);

    resolved.push({
      rowNumber: row.rowNumber,
      sku: row.sku,
      gtin: row.gtin,
      target,
      matchedOn,
      first,
      matchedValue,
    });
  }

  return resolved;
}

export interface MatchScope {
  catalogId: string;
  /**
   * Optional but supplied by every caller. Catalog membership already implies
   * the organization; constraining on both means a mistaken catalog id cannot
   * reach another tenant's products.
   */
  organizationId?: string;
}

/**
 * Resolves a whole set of rows against the catalog in ONE query.
 *
 * The query count is a property of the function, not of the row count: this is
 * what replaced the per-row `findDuplicate` round trip.
 */
export async function resolveImportMatches(
  prisma: PrismaClient | Prisma.TransactionClient,
  scope: MatchScope,
  rows: MatchRow[],
): Promise<ResolvedRow[]> {
  if (rows.length === 0) return [];

  const skus = [...new Set(rows.map((r) => r.sku).filter((s): s is string => !!s))];
  const gtins = [...new Set(rows.map((r) => r.gtin).filter((g): g is string => !!g))];

  const or: Array<Record<string, unknown>> = [];
  if (skus.length) or.push({ sku: { in: skus } });
  if (gtins.length) or.push({ gtin: { in: gtins } });

  // No identifiers at all: every row creates, and no query is worth issuing.
  if (or.length === 0) return resolveMatchesAgainst([], rows);

  const candidates = await prisma.canonicalProduct.findMany({
    where: { catalogId: scope.catalogId, organizationId: scope.organizationId, OR: or },
    select: { id: true, sku: true, gtin: true, productName: true },
  });

  return resolveMatchesAgainst(candidates, rows);
}
