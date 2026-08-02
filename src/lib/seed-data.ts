export type ProductStatus = "ready" | "needs_review" | "blocked" | "pending";
export type ChannelStatus = "live" | "rejected" | "pending" | "not_submitted";

export interface Product {
  id: string; gtin: string; sku: string; name: string; brand: string;
  category: string; subCategory: string; sourceSystem: string;
  lastModified: string; status: ProductStatus; readinessScore: number;
  attributes: Record<string, ProductAttribute>;
  channels: ChannelEntry[]; images: ProductImage[];
}
export interface ProductAttribute {
  name: string; value: string | number | boolean | null; unit?: string;
  sourceSystem: string; confidenceScore: number; autohealEligible: boolean;
  lastModified: string; issues?: AttributeIssue[];
}
export interface AttributeIssue {
  type: "missing" | "invalid" | "exceeds_limit" | "format_error" | "compliance";
  message: string; channel?: string; severity: "error" | "warning" | "info";
}
export interface ChannelEntry {
  channel: string; channelId: string; status: ChannelStatus;
  lastSubmitted?: string; rejectionReason?: string; errorCode?: string;
}
export interface ProductImage {
  url: string; type: "hero" | "lifestyle" | "detail" | "packaging";
  width: number; height: number; sizeKb: number; compliant: boolean;
}
export interface Retailer {
  id: string; name: string; logo: string;
  requiredAttributes: string[]; totalRequirements: number;
  lastSchemaUpdate: string; categories: string[];
}
export interface ValidationException {
  id: string; productId: string; productName: string; sku: string;
  channel: string; errorCode: string;
  errorType: "missing_attribute" | "invalid_value" | "exceeds_limit" | "image_issue" | "compliance";
  severity: "error" | "warning"; field: string;
  currentValue: string | null; proposedFix: string;
  aiConfidence: number; sourceDocument?: string;
  status: "open" | "approved" | "dismissed" | "in_review";
  revenueImpact?: string; assignedTo?: string; createdAt: string;
}
export interface MappingRule {
  id: string; sourceField: string; targetField: string;
  transformation?: string; confidence: number;
  status: "approved" | "pending" | "rejected";
  mappedBy: "ai" | "human"; lastUsed: string;
  retailer?: string;
}

export const RETAILERS: Retailer[] = [
  { id: "walmart", name: "Walmart", logo: "W", requiredAttributes: ["gtin","title","brand","category","short_description","long_description","key_features","weight","dimensions","country_of_origin","images_hero","images_lifestyle"], totalRequirements: 47, lastSchemaUpdate: "2026-07-15", categories: ["Electronics","Home & Garden","Sports","Apparel","CPG"] },
  { id: "target", name: "Target", logo: "T", requiredAttributes: ["tcin","title","brand","bullet_1","bullet_2","bullet_3","material","care_instructions","country_of_origin"], totalRequirements: 38, lastSchemaUpdate: "2026-07-22", categories: ["Apparel","Home","Electronics","Beauty","Food & Beverage"] },
  { id: "homedepot", name: "Home Depot", logo: "HD", requiredAttributes: ["model_number","manufacturer","title","description","specifications","warranty","installation_type"], totalRequirements: 52, lastSchemaUpdate: "2026-07-10", categories: ["Tools","Building Materials","Electrical","Plumbing","Garden"] },
  { id: "amazon", name: "Amazon", logo: "A", requiredAttributes: ["asin","title","brand","bullet_points","description","search_terms","product_type","images"], totalRequirements: 61, lastSchemaUpdate: "2026-07-28", categories: ["All Categories"] },
  { id: "costco", name: "Costco", logo: "C", requiredAttributes: ["item_number","description","brand","country_of_origin","unit_count","net_weight"], totalRequirements: 29, lastSchemaUpdate: "2026-06-30", categories: ["Food & Beverage","Electronics","Home","Apparel"] },
];

export const PRODUCTS: Product[] = [
  {
    id: "prod-001", gtin: "00012345678901", sku: "NF-JKT-APEX-M-BLK",
    name: "NorthFace APEX Flex GTX 2.0 Jacket — Men's Medium Black",
    brand: "The North Face", category: "Apparel",
    subCategory: "Outerwear > Jackets > Waterproof",
    sourceSystem: "Product360", lastModified: "2026-07-28T14:22:00Z",
    status: "needs_review", readinessScore: 64,
    images: [
      { url: "", type: "hero", width: 2000, height: 2000, sizeKb: 1240, compliant: true },
      { url: "", type: "detail", width: 800, height: 600, sizeKb: 340, compliant: false },
    ],
    attributes: {
      title: { name: "Title", value: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket — Exclusive Collection 2026 Black Medium", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-20", issues: [{ type: "exceeds_limit", message: "Amazon title exceeds 200 chars (current: 214)", channel: "Amazon", severity: "error" }] },
      brand: { name: "Brand", value: "The North Face", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      waterproof: { name: "Waterproof Rating", value: null, sourceSystem: "Product360", confidenceScore: 0, autohealEligible: true, lastModified: "2026-07-01", issues: [{ type: "missing", message: "Required by Target API — not found in PIM", channel: "Target", severity: "error" }] },
      weight: { name: "Weight", value: 1.82, unit: "lbs", sourceSystem: "Product360", confidenceScore: 0.98, autohealEligible: true, lastModified: "2026-07-20" },
      country_of_origin: { name: "Country of Origin", value: "Vietnam", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      material: { name: "Material", value: "100% Nylon GORE-TEX", sourceSystem: "Product360", confidenceScore: 0.95, autohealEligible: true, lastModified: "2026-07-20" },
    },
    channels: [
      { channel: "Target", channelId: "TGT", status: "rejected", lastSubmitted: "2026-07-27", rejectionReason: "Missing 'waterproof' attribute", errorCode: "ERR_ATTR_MISSING_042" },
      { channel: "Amazon", channelId: "AMZ", status: "rejected", lastSubmitted: "2026-07-26", rejectionReason: "Title length exceeds 200 chars", errorCode: "ERR_TITLE_LENGTH" },
      { channel: "Walmart", channelId: "WMT", status: "live", lastSubmitted: "2026-07-10" },
    ],
  },
  {
    id: "prod-002", gtin: "00098765432109", sku: "SG-HDPH-PRO-MAX-WHT",
    name: "SoundGear ProMax Wireless Noise-Cancelling Headphones — White",
    brand: "SoundGear", category: "Electronics",
    subCategory: "Audio > Headphones > Over-Ear",
    sourceSystem: "Salsify", lastModified: "2026-07-29T09:15:00Z",
    status: "blocked", readinessScore: 41,
    images: [{ url: "", type: "hero", width: 2000, height: 2000, sizeKb: 980, compliant: true }],
    attributes: {
      title: { name: "Title", value: "SoundGear ProMax Wireless Headphones", sourceSystem: "Salsify", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-15" },
      brand: { name: "Brand", value: "SoundGear", sourceSystem: "Salsify", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      weight: { name: "Weight", value: 0.71, unit: "lbs", sourceSystem: "Salsify", confidenceScore: 0.96, autohealEligible: true, lastModified: "2026-07-15" },
      country_of_origin: { name: "Country of Origin", value: "China", sourceSystem: "Salsify", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      battery_life: { name: "Battery Life", value: "40 hours", sourceSystem: "Salsify", confidenceScore: 0.92, autohealEligible: true, lastModified: "2026-07-20" },
      bluetooth_version: { name: "Bluetooth Version", value: null, sourceSystem: "Salsify", confidenceScore: 0, autohealEligible: true, lastModified: "2026-07-01", issues: [{ type: "missing", message: "Required by Walmart electronics schema v3.2", channel: "Walmart", severity: "error" }] },
      noise_cancellation: { name: "Noise Cancellation Type", value: null, sourceSystem: "Salsify", confidenceScore: 0, autohealEligible: true, lastModified: "2026-07-01", issues: [{ type: "missing", message: "Required for Amazon Headphones product type", channel: "Amazon", severity: "error" }] },
    },
    channels: [
      { channel: "Walmart", channelId: "WMT", status: "rejected", lastSubmitted: "2026-07-28", rejectionReason: "Missing bluetooth_version attribute", errorCode: "ERR_ATTR_MISSING_019" },
      { channel: "Amazon", channelId: "AMZ", status: "pending" },
      { channel: "Home Depot", channelId: "HD", status: "not_submitted" },
    ],
  },
  {
    id: "prod-003", gtin: "00056789012345", sku: "GD-FERT-ORG-5LB",
    name: "GreenDream Organic All-Purpose Fertilizer 5lb Bag",
    brand: "GreenDream", category: "Garden",
    subCategory: "Fertilizers > Organic > All-Purpose",
    sourceSystem: "Product360", lastModified: "2026-07-30T11:00:00Z",
    status: "ready", readinessScore: 97,
    images: [
      { url: "", type: "hero", width: 2000, height: 2000, sizeKb: 1100, compliant: true },
      { url: "", type: "lifestyle", width: 1500, height: 1000, sizeKb: 650, compliant: true },
    ],
    attributes: {
      title: { name: "Title", value: "GreenDream Organic All-Purpose Fertilizer, 5 lb", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-25" },
      brand: { name: "Brand", value: "GreenDream", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      country_of_origin: { name: "Country of Origin", value: "United States", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-25" },
      weight: { name: "Net Weight", value: 5, unit: "lbs", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-25" },
      npk_ratio: { name: "NPK Ratio", value: "5-3-4", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-25" },
      organic_certified: { name: "OMRI Listed", value: true, sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-25" },
    },
    channels: [
      { channel: "Home Depot", channelId: "HD", status: "live", lastSubmitted: "2026-07-26" },
      { channel: "Walmart", channelId: "WMT", status: "live", lastSubmitted: "2026-07-25" },
      { channel: "Amazon", channelId: "AMZ", status: "live", lastSubmitted: "2026-07-25" },
    ],
  },
  {
    id: "prod-004", gtin: "00034567890123", sku: "PT-PAINT-ULTRA-GAL-NVY",
    name: "ProTech UltraShield Exterior Paint — Navy Blue 1 Gallon",
    brand: "ProTech", category: "Home Improvement",
    subCategory: "Paint > Exterior > Premium",
    sourceSystem: "ERP-SAP", lastModified: "2026-07-29T16:45:00Z",
    status: "needs_review", readinessScore: 58,
    images: [{ url: "", type: "hero", width: 1200, height: 1200, sizeKb: 720, compliant: false }],
    attributes: {
      title: { name: "Title", value: "ProTech UltraShield Exterior Paint Navy Blue 1 Gal", sourceSystem: "ERP-SAP", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-20" },
      brand: { name: "Brand", value: "ProTech", sourceSystem: "ERP-SAP", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      weight: { name: "Weight", value: 11.2, unit: "lbs", sourceSystem: "ERP-SAP", confidenceScore: 0.93, autohealEligible: true, lastModified: "2026-07-20" },
      voc_content: { name: "VOC Content (g/L)", value: 48, sourceSystem: "ERP-SAP", confidenceScore: 0.85, autohealEligible: false, lastModified: "2026-07-20" },
      prop_65: { name: "Prop 65 Warning", value: null, sourceSystem: "ERP-SAP", confidenceScore: 0, autohealEligible: false, lastModified: "2026-07-01", issues: [{ type: "compliance", message: "California Prop 65 warning required for VOC-containing products", severity: "error" }] },
      coverage: { name: "Coverage (sq ft/gal)", value: 350, sourceSystem: "ERP-SAP", confidenceScore: 0.9, autohealEligible: true, lastModified: "2026-07-20" },
    },
    channels: [
      { channel: "Home Depot", channelId: "HD", status: "rejected", lastSubmitted: "2026-07-29", rejectionReason: "Missing Prop 65 warning", errorCode: "ERR_COMPLIANCE_PROP65" },
      { channel: "Walmart", channelId: "WMT", status: "pending" },
    ],
  },
  {
    id: "prod-005", gtin: "00078901234567", sku: "LX-BLNDR-PRO-1500",
    name: "Luxe Pro Series Commercial Blender 1500W — Stainless",
    brand: "Luxe Kitchen", category: "Home & Kitchen",
    subCategory: "Small Appliances > Blenders > Commercial",
    sourceSystem: "Syndigo", lastModified: "2026-07-31T08:30:00Z",
    status: "pending", readinessScore: 79,
    images: [
      { url: "", type: "hero", width: 2000, height: 2000, sizeKb: 1350, compliant: true },
      { url: "", type: "lifestyle", width: 1600, height: 1067, sizeKb: 780, compliant: true },
    ],
    attributes: {
      title: { name: "Title", value: "Luxe Pro Series 1500W Commercial Blender, Stainless Steel", sourceSystem: "Syndigo", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-28" },
      brand: { name: "Brand", value: "Luxe Kitchen", sourceSystem: "Syndigo", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      weight: { name: "Weight", value: 9.4, unit: "lbs", sourceSystem: "Syndigo", confidenceScore: 0.97, autohealEligible: true, lastModified: "2026-07-28" },
      country_of_origin: { name: "Country of Origin", value: "China", sourceSystem: "Syndigo", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      wattage: { name: "Wattage", value: 1500, unit: "W", sourceSystem: "Syndigo", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-28" },
      capacity: { name: "Capacity", value: 64, unit: "oz", sourceSystem: "Syndigo", confidenceScore: 0.98, autohealEligible: true, lastModified: "2026-07-28" },
      noise_db: { name: "Noise Level (dB)", value: null, sourceSystem: "Syndigo", confidenceScore: 0, autohealEligible: true, lastModified: "2026-07-01", issues: [{ type: "missing", message: "Costco requires noise rating for high-wattage appliances", channel: "Costco", severity: "warning" }] },
    },
    channels: [
      { channel: "Amazon", channelId: "AMZ", status: "live", lastSubmitted: "2026-07-30" },
      { channel: "Costco", channelId: "CST", status: "pending" },
      { channel: "Target", channelId: "TGT", status: "not_submitted" },
    ],
  },
  {
    id: "prod-006", gtin: "00023456789012", sku: "CF-DRIP-ELITE-BLK",
    name: "CraftBrew Elite Drip Coffee Maker 12-Cup — Matte Black",
    brand: "CraftBrew", category: "Home & Kitchen",
    subCategory: "Small Appliances > Coffee Makers > Drip",
    sourceSystem: "Product360", lastModified: "2026-07-31T10:00:00Z",
    status: "ready", readinessScore: 94,
    images: [{ url: "", type: "hero", width: 2000, height: 2000, sizeKb: 1050, compliant: true }],
    attributes: {
      title: { name: "Title", value: "CraftBrew Elite 12-Cup Drip Coffee Maker, Matte Black", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-30" },
      brand: { name: "Brand", value: "CraftBrew", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-01" },
      weight: { name: "Weight", value: 6.8, unit: "lbs", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-30" },
      country_of_origin: { name: "Country of Origin", value: "Mexico", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: false, lastModified: "2026-07-30" },
      capacity: { name: "Capacity", value: 12, unit: "cups", sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-30" },
      programmable: { name: "Programmable", value: true, sourceSystem: "Product360", confidenceScore: 1, autohealEligible: true, lastModified: "2026-07-30" },
    },
    channels: [
      { channel: "Target", channelId: "TGT", status: "live", lastSubmitted: "2026-07-30" },
      { channel: "Walmart", channelId: "WMT", status: "live", lastSubmitted: "2026-07-30" },
      { channel: "Amazon", channelId: "AMZ", status: "live", lastSubmitted: "2026-07-30" },
      { channel: "Costco", channelId: "CST", status: "pending" },
    ],
  },
];

export const EXCEPTIONS: ValidationException[] = [
  { id: "exc-001", productId: "prod-001", productName: "NorthFace APEX Flex GTX 2.0 Jacket", sku: "NF-JKT-APEX-M-BLK", channel: "Target", errorCode: "ERR_ATTR_MISSING_042", errorType: "missing_attribute", severity: "error", field: "waterproof", currentValue: null, proposedFix: "true", aiConfidence: 97, sourceDocument: "NorthFace_APEX_SpecSheet_2026.pdf", status: "open", revenueImpact: "~$4,200/mo buy box at risk", assignedTo: "Maria Chen", createdAt: "2026-07-27T09:14:00Z" },
  { id: "exc-002", productId: "prod-001", productName: "NorthFace APEX Flex GTX 2.0 Jacket", sku: "NF-JKT-APEX-M-BLK", channel: "Amazon", errorCode: "ERR_TITLE_LENGTH", errorType: "exceeds_limit", severity: "error", field: "title", currentValue: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket — Exclusive Collection 2026 Black Medium", proposedFix: "NorthFace Men's APEX Flex GTX 2.0 Waterproof Shell Jacket, Black, Medium", aiConfidence: 92, status: "open", revenueImpact: "Listing suppressed — ~$8,100/mo exposure", createdAt: "2026-07-26T14:30:00Z" },
  { id: "exc-003", productId: "prod-002", productName: "SoundGear ProMax Wireless Headphones", sku: "SG-HDPH-PRO-MAX-WHT", channel: "Walmart", errorCode: "ERR_ATTR_MISSING_019", errorType: "missing_attribute", severity: "error", field: "bluetooth_version", currentValue: null, proposedFix: "5.3", aiConfidence: 89, sourceDocument: "SoundGear_ProMax_TechSpec.pdf", status: "open", revenueImpact: "Not live — ~$6,400/mo delayed", assignedTo: "James Okafor", createdAt: "2026-07-28T11:00:00Z" },
  { id: "exc-004", productId: "prod-004", productName: "ProTech UltraShield Exterior Paint", sku: "PT-PAINT-ULTRA-GAL-NVY", channel: "Home Depot", errorCode: "ERR_COMPLIANCE_PROP65", errorType: "compliance", severity: "error", field: "prop_65", currentValue: null, proposedFix: "WARNING: This product can expose you to chemicals including Ethylbenzene, known to the State of California to cause cancer. www.P65Warnings.ca.gov", aiConfidence: 99, status: "open", revenueImpact: "Compliance block — all CA sales paused", createdAt: "2026-07-29T17:00:00Z" },
  { id: "exc-005", productId: "prod-005", productName: "Luxe Pro Series Commercial Blender", sku: "LX-BLNDR-PRO-1500", channel: "Costco", errorCode: "WARN_ATTR_MISSING_NOISE", errorType: "missing_attribute", severity: "warning", field: "noise_db", currentValue: null, proposedFix: "72", aiConfidence: 84, sourceDocument: "Luxe_Blender_1500W_Manual.pdf", status: "open", revenueImpact: "Costco Q3 window closes Aug 15", createdAt: "2026-07-31T08:45:00Z" },
];

export const MAPPING_RULES: MappingRule[] = [
  { id: "map-001", sourceField: "product_name", targetField: "title", transformation: "Truncate to 200 chars, remove special chars", confidence: 98, status: "approved", mappedBy: "human", lastUsed: "2026-07-30", retailer: "Amazon" },
  { id: "map-002", sourceField: "vendor_brand", targetField: "brand", transformation: "Direct map", confidence: 100, status: "approved", mappedBy: "human", lastUsed: "2026-07-30", retailer: "All" },
  { id: "map-003", sourceField: "product_weight_lbs", targetField: "item_weight", transformation: "Convert to oz × 16 for Walmart schema", confidence: 94, status: "approved", mappedBy: "ai", lastUsed: "2026-07-29", retailer: "Walmart" },
  { id: "map-004", sourceField: "waterproof_ip_rating", targetField: "waterproof", transformation: "IP68/IP67 → true; IP54 and below → false", confidence: 91, status: "pending", mappedBy: "ai", lastUsed: "2026-07-27", retailer: "Target" },
  { id: "map-005", sourceField: "color_code_hex", targetField: "color", transformation: "Hex → Color name via palette library", confidence: 87, status: "pending", mappedBy: "ai", lastUsed: "2026-07-28", retailer: "Walmart" },
  { id: "map-006", sourceField: "upc", targetField: "gtin14", transformation: "Pad to 14 digits with leading zeros", confidence: 99, status: "approved", mappedBy: "human", lastUsed: "2026-07-30", retailer: "All" },
];

export const CATALOG_STATS = {
  totalProducts: 6, ready: 2, needsReview: 2, blocked: 1, pending: 1,
  avgReadinessScore: Math.round(PRODUCTS.reduce((s, p) => s + p.readinessScore, 0) / PRODUCTS.length),
  openExceptions: EXCEPTIONS.filter(e => e.status === "open").length,
  liveChannels: PRODUCTS.flatMap(p => p.channels).filter(c => c.status === "live").length,
  importDate: "2026-07-31T08:00:00Z",
  sourceFile: "Product360_Export_2026-07-31.xlsx",
  totalAttributes: 847,
  attributeIssues: PRODUCTS.reduce((s, p) =>
    s + Object.values(p.attributes).filter(a => a.issues?.length).length
      + p.images.filter(i => !i.compliant).length, 0),
};
