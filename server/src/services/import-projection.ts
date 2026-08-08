import type { PrismaClient } from "@prisma/client";

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
 * Matching mirrors `findDuplicate` exactly — SKU first, then GTIN, scoped to a
 * single catalog — so the projection agrees with what the import will actually
 * do. It is a read-only preview and changes no import behaviour.
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

function value(row: ProjectionRowLike, header: string | undefined): string | null {
  if (!header) return null;
  const raw = row.data?.[header];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v.length > 0 ? v : null;
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
): Promise<ImportProjection> {
  const empty: ImportProjection = {
    totalRows: rows.length, distinctProducts: 0, willCreate: 0, willUpdate: 0, existingMatches: [],
  };
  if (!skuHeader && !gtinHeader) return empty;

  // Collapse the file to the distinct products it describes. Identity follows
  // the resolver: SKU when present, otherwise GTIN.
  const distinct = new Map<string, { sku: string | null; gtin: string | null }>();
  for (const row of rows) {
    const sku = value(row, skuHeader);
    const gtin = value(row, gtinHeader);
    const identity = sku ?? gtin;
    if (!identity) continue;
    if (!distinct.has(identity)) distinct.set(identity, { sku, gtin });
  }
  if (distinct.size === 0) return empty;

  const skus = [...new Set([...distinct.values()].map((d) => d.sku).filter((s): s is string => !!s))];
  const gtins = [...new Set([...distinct.values()].map((d) => d.gtin).filter((g): g is string => !!g))];

  const or: Array<Record<string, unknown>> = [];
  if (skus.length) or.push({ sku: { in: skus } });
  if (gtins.length) or.push({ gtin: { in: gtins } });
  if (or.length === 0) return { ...empty, distinctProducts: distinct.size, willCreate: distinct.size };

  const existing = await prisma.canonicalProduct.findMany({
    where: { catalogId, OR: or },
    select: { id: true, sku: true, gtin: true, productName: true },
  });

  const bySku = new Map<string, (typeof existing)[number]>();
  const byGtin = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p);
    if (p.gtin && !byGtin.has(p.gtin)) byGtin.set(p.gtin, p);
  }

  const matches: ExistingMatch[] = [];
  let willUpdate = 0;

  for (const [identity, { sku, gtin }] of distinct) {
    // SKU takes precedence, matching findDuplicate's order.
    const hit = (sku && bySku.get(sku)) || (gtin && byGtin.get(gtin)) || null;
    if (hit) {
      willUpdate++;
      matches.push({
        key: identity,
        matchedOn: sku && bySku.get(sku) ? "sku" : "gtin",
        productId: hit.id,
        productName: hit.productName,
      });
    }
  }

  return {
    totalRows: rows.length,
    distinctProducts: distinct.size,
    willCreate: distinct.size - willUpdate,
    willUpdate,
    existingMatches: matches,
  };
}
