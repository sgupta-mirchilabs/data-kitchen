// Mapping Studio dataset — source PIM fields → retailer schema fields
// Kept separate from seed-data.ts so Screens 1 & 2 stay untouched.

export type MappingStatus = "approved" | "pending" | "rejected";
export type TransformType = "direct" | "convert" | "truncate" | "derive" | "lookup" | "split" | "compliance";

export interface Mapping {
  id: string;
  retailer: string;
  sourceField: string;
  sourceSystem: string;
  sourceSample: string;
  targetField: string;
  targetLabel: string;
  required: boolean;
  transformation: string;
  transformType: TransformType;
  confidence: number;
  status: MappingStatus;
  mappedBy: "ai" | "human";
  outputSample: string;
  affects: number;
  note?: string;
}

export interface UnmappedTarget {
  id: string;
  retailer: string;
  targetField: string;
  targetLabel: string;
  required: boolean;
  reason: string;
  aiSuggestion: string;
  suggestionConfidence: number;
  affects: number;
}

export const TRANSFORM_META: Record<TransformType, { label: string; color: string }> = {
  direct: { label: "Direct", color: "var(--text-muted)" },
  convert: { label: "Convert", color: "var(--blue)" },
  truncate: { label: "Truncate", color: "var(--amber)" },
  derive: { label: "Derive", color: "var(--purple)" },
  lookup: { label: "Lookup", color: "var(--blue)" },
  split: { label: "Split", color: "var(--purple)" },
  compliance: { label: "Compliance", color: "var(--red)" },
};

export const MAPPINGS: Mapping[] = [
  // ── Walmart ────────────────────────────────────────────────────────────────
  { id: "w1", retailer: "walmart", sourceField: "product_name", sourceSystem: "Product360", sourceSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket — Exclusive Collection 2026 Black Medium", targetField: "productName", targetLabel: "Product Name", required: true, transformation: "Truncate to 200 chars · strip em-dashes", transformType: "truncate", confidence: 98, status: "approved", mappedBy: "human", outputSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket, Black, Medium", affects: 6 },
  { id: "w2", retailer: "walmart", sourceField: "vendor_brand", sourceSystem: "Product360", sourceSample: "The North Face", targetField: "brand", targetLabel: "Brand", required: true, transformation: "Direct map", transformType: "direct", confidence: 100, status: "approved", mappedBy: "human", outputSample: "The North Face", affects: 6 },
  { id: "w3", retailer: "walmart", sourceField: "upc", sourceSystem: "Product360", sourceSample: "012345678901", targetField: "gtin14", targetLabel: "GTIN-14", required: true, transformation: "Pad to 14 digits with leading zeros", transformType: "convert", confidence: 99, status: "approved", mappedBy: "human", outputSample: "00012345678901", affects: 6 },
  { id: "w4", retailer: "walmart", sourceField: "product_weight_lbs", sourceSystem: "Product360", sourceSample: "1.82 lbs", targetField: "itemWeight", targetLabel: "Item Weight (oz)", required: true, transformation: "lbs → oz (× 16), round to 2dp", transformType: "convert", confidence: 94, status: "approved", mappedBy: "ai", outputSample: "29.12 oz", affects: 5 },
  { id: "w5", retailer: "walmart", sourceField: "origin_country", sourceSystem: "Product360", sourceSample: "VN", targetField: "countryOfOrigin", targetLabel: "Country of Origin", required: true, transformation: "ISO-3166 alpha-2 → full country name", transformType: "lookup", confidence: 96, status: "approved", mappedBy: "ai", outputSample: "Vietnam", affects: 4 },
  { id: "w6", retailer: "walmart", sourceField: "primary_image_url", sourceSystem: "Product360", sourceSample: "cdn/p360/nf-jkt-apex-hero.jpg (2000×2000)", targetField: "mainImageUrl", targetLabel: "Main Image URL", required: true, transformation: "Validate ≥2000×2000 · reject non-compliant", transformType: "convert", confidence: 93, status: "approved", mappedBy: "ai", outputSample: "https://cdn.mirchi.io/wmt/nf-jkt-apex-hero.jpg ✓", affects: 6 },
  { id: "w7", retailer: "walmart", sourceField: "color_code_hex", sourceSystem: "Product360", sourceSample: "#1C1C1E", targetField: "color", targetLabel: "Color", required: false, transformation: "Hex → nearest Walmart palette color name", transformType: "lookup", confidence: 87, status: "pending", mappedBy: "ai", outputSample: "Black", affects: 5, note: "Palette library resolves 142 Walmart-approved color names" },
  { id: "w8", retailer: "walmart", sourceField: "long_description", sourceSystem: "Product360", sourceSample: "<p>Built for wet-weather performance, the APEX Flex GTX 2.0…</p>", targetField: "shortDescription", targetLabel: "Short Description", required: true, transformation: "Strip HTML · truncate to 500 chars at sentence break", transformType: "truncate", confidence: 88, status: "pending", mappedBy: "ai", outputSample: "Built for wet-weather performance, the APEX Flex GTX 2.0 pairs a waterproof GORE-TEX shell with stretch mobility.", affects: 6 },
  { id: "w9", retailer: "walmart", sourceField: "bluetooth_ver", sourceSystem: "Salsify", sourceSample: "(empty)", targetField: "bluetoothVersion", targetLabel: "Bluetooth Version", required: true, transformation: "Extract from spec sheet PDF via document AI", transformType: "derive", confidence: 89, status: "pending", mappedBy: "ai", outputSample: "5.3", affects: 1, note: "Sourced from SoundGear_ProMax_TechSpec.pdf, p.4" },

  // ── Target ─────────────────────────────────────────────────────────────────
  { id: "t1", retailer: "target", sourceField: "product_name", sourceSystem: "Product360", sourceSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket…", targetField: "title", targetLabel: "Title", required: true, transformation: "Truncate to 150 chars · title case", transformType: "truncate", confidence: 97, status: "approved", mappedBy: "human", outputSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket", affects: 6 },
  { id: "t2", retailer: "target", sourceField: "vendor_brand", sourceSystem: "Product360", sourceSample: "The North Face", targetField: "brand", targetLabel: "Brand", required: true, transformation: "Direct map", transformType: "direct", confidence: 100, status: "approved", mappedBy: "human", outputSample: "The North Face", affects: 6 },
  { id: "t3", retailer: "target", sourceField: "upc", sourceSystem: "Product360", sourceSample: "012345678901", targetField: "tcin", targetLabel: "TCIN", required: true, transformation: "UPC → TCIN via Target Partners lookup", transformType: "lookup", confidence: 95, status: "approved", mappedBy: "ai", outputSample: "89204471", affects: 4 },
  { id: "t4", retailer: "target", sourceField: "waterproof_ip_rating", sourceSystem: "Product360", sourceSample: "IP68", targetField: "waterproof", targetLabel: "Waterproof", required: true, transformation: "IP67/IP68 → true · IP54 and below → false", transformType: "convert", confidence: 91, status: "pending", mappedBy: "ai", outputSample: "true", affects: 1, note: "Resolves the Target rejection on NF-JKT-APEX-M-BLK" },
  { id: "t5", retailer: "target", sourceField: "material_composition", sourceSystem: "Product360", sourceSample: "100% Nylon GORE-TEX", targetField: "material", targetLabel: "Material", required: true, transformation: "Normalize to Target material taxonomy", transformType: "lookup", confidence: 93, status: "approved", mappedBy: "ai", outputSample: "Nylon", affects: 3 },
  { id: "t6", retailer: "target", sourceField: "long_description", sourceSystem: "Product360", sourceSample: "<p>Built for wet-weather performance…</p>", targetField: "bulletPoints", targetLabel: "Bullet Points (3)", required: true, transformation: "Split into 3 feature bullets · max 80 chars each", transformType: "split", confidence: 84, status: "pending", mappedBy: "ai", outputSample: "1. Waterproof GORE-TEX shell  2. Stretch mobility panels  3. Fully seam-sealed", affects: 6, note: "Target rejects listings with fewer than 3 bullets" },

  // ── Amazon ─────────────────────────────────────────────────────────────────
  { id: "a1", retailer: "amazon", sourceField: "product_name", sourceSystem: "Product360", sourceSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket — Exclusive Collection 2026 Black Medium (214 chars)", targetField: "item_name", targetLabel: "Item Name", required: true, transformation: "Truncate to 200 chars · remove promotional language", transformType: "truncate", confidence: 92, status: "approved", mappedBy: "human", outputSample: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket, Black, Medium (72 chars)", affects: 6, note: "Fixes ERR_TITLE_LENGTH on NF-JKT-APEX-M-BLK" },
  { id: "a2", retailer: "amazon", sourceField: "vendor_brand", sourceSystem: "Product360", sourceSample: "The North Face", targetField: "brand_name", targetLabel: "Brand Name", required: true, transformation: "Direct map", transformType: "direct", confidence: 100, status: "approved", mappedBy: "human", outputSample: "The North Face", affects: 6 },
  { id: "a3", retailer: "amazon", sourceField: "upc", sourceSystem: "Product360", sourceSample: "012345678901", targetField: "external_product_id", targetLabel: "External Product ID", required: true, transformation: "Set type=UPC · validate check digit", transformType: "convert", confidence: 99, status: "approved", mappedBy: "human", outputSample: "012345678901 (UPC ✓)", affects: 6 },
  { id: "a4", retailer: "amazon", sourceField: "sub_category", sourceSystem: "Product360", sourceSample: "Outerwear > Jackets > Waterproof", targetField: "product_type", targetLabel: "Product Type", required: true, transformation: "Map to Amazon browse-node taxonomy", transformType: "lookup", confidence: 86, status: "pending", mappedBy: "ai", outputSample: "OUTERWEAR_JACKET", affects: 6 },
  { id: "a5", retailer: "amazon", sourceField: "long_description", sourceSystem: "Product360", sourceSample: "<p>Built for wet-weather performance…</p>", targetField: "bullet_point", targetLabel: "Bullet Points (5)", required: true, transformation: "Split into 5 bullets · max 500 chars each", transformType: "split", confidence: 83, status: "pending", mappedBy: "ai", outputSample: "5 bullets generated from description + attributes", affects: 6 },
  { id: "a6", retailer: "amazon", sourceField: "noise_cancellation", sourceSystem: "Salsify", sourceSample: "(empty)", targetField: "noise_cancellation_type", targetLabel: "Noise Cancellation Type", required: true, transformation: "Extract from manufacturer spec PDF", transformType: "derive", confidence: 88, status: "pending", mappedBy: "ai", outputSample: "Active Noise Cancellation", affects: 1 },

  // ── Home Depot ─────────────────────────────────────────────────────────────
  { id: "h1", retailer: "homedepot", sourceField: "sku", sourceSystem: "ERP-SAP", sourceSample: "PT-PAINT-ULTRA-GAL-NVY", targetField: "modelNumber", targetLabel: "Model Number", required: true, transformation: "Strip vendor prefix · uppercase", transformType: "convert", confidence: 90, status: "approved", mappedBy: "ai", outputSample: "PAINT-ULTRA-GAL-NVY", affects: 6 },
  { id: "h2", retailer: "homedepot", sourceField: "vendor_brand", sourceSystem: "ERP-SAP", sourceSample: "ProTech", targetField: "manufacturer", targetLabel: "Manufacturer", required: true, transformation: "Direct map", transformType: "direct", confidence: 100, status: "approved", mappedBy: "human", outputSample: "ProTech", affects: 6 },
  { id: "h3", retailer: "homedepot", sourceField: "product_name", sourceSystem: "ERP-SAP", sourceSample: "ProTech UltraShield Exterior Paint Navy Blue 1 Gal", targetField: "title", targetLabel: "Title", required: true, transformation: "Truncate to 100 chars", transformType: "truncate", confidence: 96, status: "approved", mappedBy: "human", outputSample: "ProTech UltraShield Exterior Paint Navy Blue 1 Gal", affects: 6 },
  { id: "h4", retailer: "homedepot", sourceField: "voc_content", sourceSystem: "ERP-SAP", sourceSample: "48", targetField: "specifications.vocContent", targetLabel: "VOC Content (g/L)", required: true, transformation: "Append unit · nest under specifications object", transformType: "convert", confidence: 95, status: "approved", mappedBy: "ai", outputSample: "48 g/L", affects: 1 },
  { id: "h5", retailer: "homedepot", sourceField: "voc_content", sourceSystem: "ERP-SAP", sourceSample: "48 g/L (VOC > 0)", targetField: "caProp65Warning", targetLabel: "CA Prop 65 Warning", required: true, transformation: "If VOC > 0 → inject Prop 65 chemical warning text", transformType: "compliance", confidence: 99, status: "pending", mappedBy: "ai", outputSample: "WARNING: This product can expose you to Ethylbenzene, known to the State of California to cause cancer. www.P65Warnings.ca.gov", affects: 1, note: "Unblocks all California sales on PT-PAINT-ULTRA-GAL-NVY" },

  // ── Costco ─────────────────────────────────────────────────────────────────
  { id: "c1", retailer: "costco", sourceField: "upc", sourceSystem: "Syndigo", sourceSample: "078901234567", targetField: "itemNumber", targetLabel: "Item Number", required: true, transformation: "UPC → Costco item number via vendor portal", transformType: "lookup", confidence: 94, status: "approved", mappedBy: "ai", outputSample: "1472839", affects: 3 },
  { id: "c2", retailer: "costco", sourceField: "product_name", sourceSystem: "Syndigo", sourceSample: "Luxe Pro Series 1500W Commercial Blender, Stainless Steel (57 chars)", targetField: "description", targetLabel: "Description", required: true, transformation: "Truncate to 65 chars · drop trailing modifiers", transformType: "truncate", confidence: 91, status: "approved", mappedBy: "ai", outputSample: "Luxe Pro Series 1500W Commercial Blender, Stainless", affects: 6 },
  { id: "c3", retailer: "costco", sourceField: "vendor_brand", sourceSystem: "Syndigo", sourceSample: "Luxe Kitchen", targetField: "brand", targetLabel: "Brand", required: true, transformation: "Direct map", transformType: "direct", confidence: 100, status: "approved", mappedBy: "human", outputSample: "Luxe Kitchen", affects: 6 },
  { id: "c4", retailer: "costco", sourceField: "product_weight_lbs", sourceSystem: "Syndigo", sourceSample: "5 lbs", targetField: "netWeight", targetLabel: "Net Weight", required: true, transformation: "Direct map · append unit", transformType: "direct", confidence: 98, status: "approved", mappedBy: "human", outputSample: "5 lbs", affects: 4 },
  { id: "c5", retailer: "costco", sourceField: "noise_db", sourceSystem: "Syndigo", sourceSample: "(empty)", targetField: "noiseLevel", targetLabel: "Noise Level (dB)", required: false, transformation: "Extract dB rating from product manual PDF", transformType: "derive", confidence: 84, status: "pending", mappedBy: "ai", outputSample: "72 dB", affects: 1, note: "Costco Q3 submission window closes Aug 15" },
];

export const UNMAPPED: UnmappedTarget[] = [
  { id: "uw1", retailer: "walmart", targetField: "keyFeatures", targetLabel: "Key Features", required: true, reason: "No equivalent field in Product360 export", aiSuggestion: "Derive from long_description + attribute set", suggestionConfidence: 81, affects: 6 },
  { id: "uw2", retailer: "walmart", targetField: "shelfDescription", targetLabel: "Shelf Description", required: true, reason: "Not present in source PIM", aiSuggestion: "Truncate productName to 80 chars", suggestionConfidence: 90, affects: 6 },
  { id: "uw3", retailer: "walmart", targetField: "assembledProductLength", targetLabel: "Assembled Length", required: false, reason: "Dimensions not populated in Product360", aiSuggestion: "Extract from packaging spec sheet", suggestionConfidence: 68, affects: 4 },
  { id: "ut1", retailer: "target", targetField: "careInstructions", targetLabel: "Care Instructions", required: true, reason: "Required for Apparel — no source field", aiSuggestion: "Derive from material_composition via care-code library", suggestionConfidence: 79, affects: 1 },
  { id: "ut2", retailer: "target", targetField: "assortmentType", targetLabel: "Assortment Type", required: false, reason: "Target-specific merchandising field", aiSuggestion: "Default to 'Basic' pending merchant input", suggestionConfidence: 62, affects: 6 },
  { id: "ua1", retailer: "amazon", targetField: "generic_keywords", targetLabel: "Search Terms", required: true, reason: "No keyword field in source PIM", aiSuggestion: "Generate from title + category + attributes", suggestionConfidence: 77, affects: 6 },
  { id: "ua2", retailer: "amazon", targetField: "other_image_url", targetLabel: "Alt Images (5)", required: true, reason: "Only 1–2 images per product in source", aiSuggestion: "Flag for creative team — cannot auto-generate", suggestionConfidence: 0, affects: 6 },
  { id: "uh1", retailer: "homedepot", targetField: "warrantyInformation", targetLabel: "Warranty Information", required: true, reason: "No warranty data in ERP-SAP", aiSuggestion: "Extract from vendor warranty PDF library", suggestionConfidence: 73, affects: 6 },
  { id: "uh2", retailer: "homedepot", targetField: "installationType", targetLabel: "Installation Type", required: false, reason: "Not applicable to all categories", aiSuggestion: "Default 'No Installation Required' for Paint", suggestionConfidence: 85, affects: 2 },
  { id: "uc1", retailer: "costco", targetField: "unitCount", targetLabel: "Unit Count / Pack Size", required: true, reason: "Pack configuration not in Syndigo export", aiSuggestion: "Parse from product_name + case spec", suggestionConfidence: 74, affects: 6 },
];
