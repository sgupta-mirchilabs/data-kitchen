import type { PrismaClient } from "@prisma/client";
import {
  matchRowFromRaw,
  resolveImportMatches,
  targetKey,
  type ResolvedRow,
} from "./import-matching.js";

/**
 * Projects an import's effect on the target catalog, before anything is written.
 *
 * The in-file duplicate warning tells the operator that a later row supersedes
 * an earlier one from the same upload. It says nothing about rows that collide
 * with products already in the catalog — which is the more consequential case,
 * because the data being overwritten may have been curated over weeks rather
 * than seconds, and there is currently no product edit or delete in the UI to
 * undo it.
 *
 * Matching is no longer "mirrored" from the commit pipeline — since Increment B
 * both run `resolveImportMatches`, so the projection cannot drift from what the
 * import will actually do. This file is now only aggregation: turning per-row
 * classifications into the counts the confirm screen shows.
 */

export interface ProjectionRowLike {
  rowNumber: number;
  data: Record<string, string>;
}

export interface ExistingMatch {
  /** The file value that matched. */
  key: string;
  matchedOn: "sku" | "gtin";
  productId: string;
  /** Current name of the product that would be overwritten. */
  productName: string | null;
}

export interface ImportProjection {
  totalRows: number;
  /** Distinct products the file describes, after collapsing in-file repeats. */
  distinctProducts: number;
  willCreate: number;
  willUpdate: number;
  existingMatches: ExistingMatch[];
}

/**
 * One batched query, not one per row — a 10,000-row file must not become 10,000
 * round trips.
 */
export async function projectImportImpact(
  prisma: PrismaClient,
  catalogId: string,
  rows: ProjectionRowLike[],
  skuHeader: string | undefined,
  gtinHeader: string | undefined,
  organizationId?: string,
): Promise<ImportProjection> {
  const empty: ImportProjection = {
    totalRows: rows.length, distinctProducts: 0, willCreate: 0, willUpdate: 0, existingMatches: [],
  };
  if (!skuHeader && !gtinHeader) return empty;

  const matchRows = rows.map((row) => matchRowFromRaw(row, skuHeader, gtinHeader));
  // A row with neither identifier is not a product this projection can speak
  // about; it is excluded from the counts, as it always has been.
  const identified = matchRows.filter((r) => r.sku !== null || r.gtin !== null);
  if (identified.length === 0) return empty;

  const resolved = await resolveImportMatches(prisma, { catalogId, organizationId }, identified);

  const seen = new Set<string>();
  const matches: ExistingMatch[] = [];
  let willUpdate = 0;
  let willCreate = 0;

  for (const row of resolved as ResolvedRow[]) {
    const key = targetKey(row.target);
    if (seen.has(key)) continue;
    seen.add(key);

    if (row.target.kind === "existing") {
      willUpdate++;
      matches.push({
        key: row.matchedValue!,
        matchedOn: row.matchedOn!,
        productId: row.target.productId,
        productName: row.target.productName,
      });
    } else {
      willCreate++;
    }
  }

  return {
    totalRows: rows.length,
    distinctProducts: seen.size,
    willCreate,
    willUpdate,
    existingMatches: matches,
  };
}
