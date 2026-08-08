export interface FieldMapping {
  sku?: string;
  gtin?: string;
  product_name?: string;
  brand?: string;
  category?: string;
  short_description?: string;
  long_description?: string;
  manufacturer?: string;
  [key: string]: string | undefined;
}

export interface NormalizedProduct {
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  productName: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  manufacturer: string | null;
  attributes: Record<string, unknown>;
}

export interface ProvenanceEntry {
  canonicalField: string;
  sourceField: string;
  originalValue: string;
  normalizedValue: string;
  normalizationMethod: string;
}

interface NormalizationResult {
  product: NormalizedProduct;
  provenance: ProvenanceEntry[];
}

const CORE_FIELDS = [
  "sku", "gtin", "product_name", "brand", "category",
  "short_description", "long_description", "manufacturer",
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku", "item_sku", "product_sku", "item sku", "product sku", "item_number", "item number", "model_number", "model number", "part_number", "part number"],
  gtin: ["gtin", "gtin14", "gtin_14", "upc", "ean", "barcode", "upc_code", "ean_code"],
  product_name: ["product_name", "product name", "name", "title", "item_name", "item name", "product_title", "product title", "item_title", "item title", "description"],
  brand: ["brand", "brand_name", "brand name", "vendor", "vendor_brand", "manufacturer_brand"],
  category: ["category", "product_category", "product category", "department", "product_type", "product type", "item_type", "item type"],
  short_description: ["short_description", "short description", "short_desc", "short desc", "summary", "brief_description"],
  long_description: ["long_description", "long description", "long_desc", "long desc", "full_description", "detailed_description"],
  manufacturer: ["manufacturer", "mfr", "maker", "produced_by", "made_by"],
};

export function suggestFieldMappings(headers: string[]): FieldMapping {
  const mappings: FieldMapping = {};

  for (const header of headers) {
    const normalized = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (mappings[canonical]) continue;

      const match = aliases.some((alias) => {
        const normalizedAlias = alias.replace(/[^a-z0-9]+/g, "_");
        return normalized === normalizedAlias;
      });

      if (match) {
        mappings[canonical] = header;
        break;
      }
    }
  }

  return mappings;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value.trim();
}

/**
 * Exported because matching must compare like with like. A GTIN is stored
 * padded to 14 digits, so anything resolving a row against the catalog has to
 * apply the same normalization before it looks — see `import-matching.ts`.
 */
export function normalizeGtin(raw: string): { value: string; method: string } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 14 && digits.length >= 8) {
    const padded = digits.padStart(14, "0");
    return { value: padded, method: digits.length < 14 ? "padded_to_gtin14" : "direct" };
  }
  return { value: raw.trim(), method: "passthrough" };
}

export function normalizeRow(
  row: Record<string, string>,
  fieldMappings: FieldMapping,
): NormalizationResult {
  const provenance: ProvenanceEntry[] = [];
  const attributes: Record<string, unknown> = {};

  const mapped = new Set<string>();

  function getAndTrack(canonicalField: string, sourceField: string | undefined): string | null {
    if (!sourceField) return null;
    mapped.add(sourceField);
    const raw = row[sourceField];
    return emptyToNull(raw) !== null ? raw.trim() : null;
  }

  const rawSku = getAndTrack("sku", fieldMappings.sku);
  const rawGtin = getAndTrack("gtin", fieldMappings.gtin);
  const rawProductName = getAndTrack("product_name", fieldMappings.product_name);
  const rawBrand = getAndTrack("brand", fieldMappings.brand);
  const rawCategory = getAndTrack("category", fieldMappings.category);
  const rawShortDesc = getAndTrack("short_description", fieldMappings.short_description);
  const rawLongDesc = getAndTrack("long_description", fieldMappings.long_description);
  const rawManufacturer = getAndTrack("manufacturer", fieldMappings.manufacturer);

  const sku = emptyToNull(rawSku ?? undefined);
  if (sku && fieldMappings.sku) {
    provenance.push({
      canonicalField: "sku",
      sourceField: fieldMappings.sku,
      originalValue: rawSku!,
      normalizedValue: sku,
      normalizationMethod: "trimmed",
    });
  }

  let gtin: string | null = null;
  if (rawGtin && fieldMappings.gtin) {
    const result = normalizeGtin(rawGtin);
    gtin = result.value;
    provenance.push({
      canonicalField: "gtin",
      sourceField: fieldMappings.gtin,
      originalValue: rawGtin,
      normalizedValue: gtin,
      normalizationMethod: result.method,
    });
  }

  const simpleFields = [
    { canonical: "product_name", raw: rawProductName, source: fieldMappings.product_name },
    { canonical: "brand", raw: rawBrand, source: fieldMappings.brand },
    { canonical: "category", raw: rawCategory, source: fieldMappings.category },
    { canonical: "short_description", raw: rawShortDesc, source: fieldMappings.short_description },
    { canonical: "long_description", raw: rawLongDesc, source: fieldMappings.long_description },
    { canonical: "manufacturer", raw: rawManufacturer, source: fieldMappings.manufacturer },
  ] as const;

  for (const { canonical, raw, source } of simpleFields) {
    if (raw && source) {
      provenance.push({
        canonicalField: canonical,
        sourceField: source,
        originalValue: raw,
        normalizedValue: raw.trim(),
        normalizationMethod: "trimmed",
      });
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (mapped.has(key)) continue;
    if (emptyToNull(value) !== null) {
      attributes[key] = value.trim();
    }
  }

  return {
    product: {
      sku,
      gtin,
      brand: emptyToNull(rawBrand ?? undefined),
      productName: emptyToNull(rawProductName ?? undefined),
      shortDescription: emptyToNull(rawShortDesc ?? undefined),
      longDescription: emptyToNull(rawLongDesc ?? undefined),
      category: emptyToNull(rawCategory ?? undefined),
      manufacturer: emptyToNull(rawManufacturer ?? undefined),
      attributes,
    },
    provenance,
  };
}

export function computeDataQualityStatus(product: NormalizedProduct): string {
  const coreFields = [product.sku, product.productName, product.brand, product.category];
  const missingCore = coreFields.filter((f) => f === null);
  if (missingCore.length > 0) return "missing_core_fields";
  return "complete";
}
