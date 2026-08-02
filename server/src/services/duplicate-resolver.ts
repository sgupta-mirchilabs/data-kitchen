import type { PrismaClient } from "@prisma/client";

export interface DuplicateMatch {
  existingProductId: string;
  matchedOn: "sku" | "gtin";
}

export async function findDuplicate(
  prisma: PrismaClient,
  catalogId: string,
  sku: string | null,
  gtin: string | null,
): Promise<DuplicateMatch | null> {
  if (sku) {
    const bySkuMatch = await prisma.canonicalProduct.findFirst({
      where: { catalogId, sku },
      select: { id: true },
    });
    if (bySkuMatch) {
      return { existingProductId: bySkuMatch.id, matchedOn: "sku" };
    }
  }

  if (gtin) {
    const byGtinMatch = await prisma.canonicalProduct.findFirst({
      where: { catalogId, gtin },
      select: { id: true },
    });
    if (byGtinMatch) {
      return { existingProductId: byGtinMatch.id, matchedOn: "gtin" };
    }
  }

  return null;
}
