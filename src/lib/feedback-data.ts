// Retail Feedback dataset — raw retailer rejections, decoded into plain English
// with a root cause and a fix path back into the Data Kitchen workflow.

export type FeedbackStatus = "new" | "triaged" | "queued" | "resubmitted" | "resolved";
export type Resolution = "auto" | "assisted" | "manual";

export interface RetailerFeedback {
  id: string;
  retailer: string;
  sku: string;
  productName: string;
  receivedAt: string;
  /** Verbatim, unhelpful message the retailer actually returns */
  rawCode: string;
  rawMessage: string;
  /** What it actually means, in English */
  decoded: string;
  rootCause: string;
  fixPath: string;
  resolution: Resolution;
  confidence: number;
  field: string;
  revenueUsd: number;
  daysOffline: number;
  status: FeedbackStatus;
  recurrence: number;
  owner?: string;
}

export const RESOLUTION_META: Record<Resolution, { label: string; color: string }> = {
  auto: { label: "Auto-resolvable", color: "var(--green)" },
  assisted: { label: "AI-assisted", color: "var(--purple)" },
  manual: { label: "Manual work", color: "var(--amber)" },
};

export const FEEDBACK: RetailerFeedback[] = [
  {
    id: "fb-001", retailer: "Target", sku: "NF-JKT-APEX-M-BLK", productName: "NorthFace APEX Flex GTX 2.0 Jacket",
    receivedAt: "2026-07-27T09:14:00Z",
    rawCode: "ERR_ATTR_MISSING_042",
    rawMessage: "Item rejected. Attribute validation failed for item group OUTERWEAR. Ref: 042.",
    decoded: "Target requires a waterproof rating on every item in Outerwear › Jackets. Your submission had no value for that attribute.",
    rootCause: "Product360 stores this as waterproof_ip_rating (IP68). Target expects a boolean named waterproof — no mapping existed until now.",
    fixPath: "Mapping rule map-004 converts IP67/IP68 → true. Approve it in Mapping Studio and resubmit.",
    resolution: "auto", confidence: 97, field: "waterproof", revenueUsd: 4200, daysOffline: 5, status: "new", recurrence: 3, owner: "Maria Chen",
  },
  {
    id: "fb-002", retailer: "Amazon", sku: "NF-JKT-APEX-M-BLK", productName: "NorthFace APEX Flex GTX 2.0 Jacket",
    receivedAt: "2026-07-26T14:30:00Z",
    rawCode: "90220",
    rawMessage: "The value provided for item_name is invalid. Please correct and resubmit. (90220)",
    decoded: "Your title is 214 characters. Amazon caps item_name at 200 for this product type, so the listing was suppressed rather than rejected outright.",
    rootCause: "Marketing appended “— Exclusive Collection 2026” to the PIM title. That suffix pushes every jacket SKU over the limit.",
    fixPath: "Truncation rule strips promotional suffixes and cuts at the last clean word boundary. Output: 72 chars.",
    resolution: "auto", confidence: 92, field: "item_name", revenueUsd: 8100, daysOffline: 6, status: "new", recurrence: 7,
  },
  {
    id: "fb-003", retailer: "Home Depot", sku: "PT-PAINT-ULTRA-GAL-NVY", productName: "ProTech UltraShield Exterior Paint",
    receivedAt: "2026-07-29T17:00:00Z",
    rawCode: "ERR_COMPLIANCE_PROP65",
    rawMessage: "Item cannot be listed in CA. Required regulatory disclosure absent.",
    decoded: "California Prop 65 requires a chemical warning on any product containing VOCs. Your VOC content is 48 g/L, so the warning is mandatory — and it was blank.",
    rootCause: "ERP-SAP tracks voc_content but has no field for the warning text itself. Nobody owned generating it.",
    fixPath: "Compliance rule fires when VOC > 0 and injects the Ethylbenzene warning with the P65Warnings.ca.gov URL.",
    resolution: "auto", confidence: 99, field: "caProp65Warning", revenueUsd: 12500, daysOffline: 3, status: "new", recurrence: 1,
  },
  {
    id: "fb-004", retailer: "Walmart", sku: "SG-HDPH-PRO-MAX-WHT", productName: "SoundGear ProMax Wireless Headphones",
    receivedAt: "2026-07-28T11:00:00Z",
    rawCode: "ERR_ATTR_MISSING_019",
    rawMessage: "Spec validation error: required attribute not supplied for category 3944.",
    decoded: "Category 3944 is Walmart's Headphones taxonomy. Their v3.2 schema added bluetooth_version as required in June — your feed predates that change.",
    rootCause: "Schema drift. Walmart changed requirements; nothing in the pipeline flagged it until listings started failing.",
    fixPath: "Document AI pulled “Bluetooth 5.3” from SoundGear_ProMax_TechSpec.pdf, p.4. Approve in Validation and resubmit.",
    resolution: "assisted", confidence: 89, field: "bluetooth_version", revenueUsd: 6400, daysOffline: 4, status: "new", recurrence: 2, owner: "James Okafor",
  },
  {
    id: "fb-005", retailer: "Amazon", sku: "SG-HDPH-PRO-MAX-WHT", productName: "SoundGear ProMax Wireless Headphones",
    receivedAt: "2026-07-30T14:00:00Z",
    rawCode: "8541",
    rawMessage: "Listing quality below threshold. Image count insufficient. (8541)",
    decoded: "Amazon wants 6 images for Headphones — one hero plus five alternates. You have one. This isn't a hard rejection, but it caps your search placement.",
    rootCause: "The brand only ever supplied a single hero image. No alternates exist in any connected system.",
    fixPath: "Cannot be generated. Requires a photography request to the brand or Mirchi's creative team.",
    resolution: "manual", confidence: 0, field: "other_image_url", revenueUsd: 1900, daysOffline: 2, status: "new", recurrence: 4, owner: "Priya Raman",
  },
  {
    id: "fb-006", retailer: "Target", sku: "NF-JKT-APEX-M-BLK", productName: "NorthFace APEX Flex GTX 2.0 Jacket",
    receivedAt: "2026-07-27T09:16:00Z",
    rawCode: "ERR_ATTR_MISSING_118",
    rawMessage: "Attribute validation failed for item group APPAREL. Ref: 118.",
    decoded: "Target requires care instructions on all Apparel items. Ref 118 is their internal code for that field — it isn't documented in the partner portal.",
    rootCause: "No care_instructions field exists anywhere in Product360 for this brand.",
    fixPath: "Derive from material_composition (100% Nylon GORE-TEX) using the care-code library. Needs a human to confirm before it ships.",
    resolution: "assisted", confidence: 81, field: "care_instructions", revenueUsd: 3600, daysOffline: 5, status: "new", recurrence: 2,
  },
  {
    id: "fb-007", retailer: "Costco", sku: "LX-BLNDR-PRO-1500", productName: "Luxe Pro Series Commercial Blender",
    receivedAt: "2026-07-31T08:45:00Z",
    rawCode: "WARN_SPEC_INCOMPLETE",
    rawMessage: "Item accepted with warnings. Review vendor portal for details.",
    decoded: "Costco accepted the item but flagged a missing noise rating. High-wattage appliances need a dB value before the Q3 buying window closes on Aug 15.",
    rootCause: "Syndigo has no noise_db field populated for this SKU. The value exists in the product manual PDF.",
    fixPath: "Document AI extracted 72 dB from Luxe_Blender_1500W_Manual.pdf. Approve and resubmit before Aug 15.",
    resolution: "assisted", confidence: 84, field: "noise_db", revenueUsd: 3100, daysOffline: 0, status: "new", recurrence: 1,
  },
  {
    id: "fb-008", retailer: "Home Depot", sku: "PT-PAINT-ULTRA-GAL-NVY", productName: "ProTech UltraShield Exterior Paint",
    receivedAt: "2026-07-29T18:10:00Z",
    rawCode: "IMG_RES_LOW",
    rawMessage: "Asset rejected: does not meet minimum specification.",
    decoded: "Your hero image is 1200×1200. Home Depot's minimum is 2000×2000 — anything smaller is dropped silently, leaving the listing image-less.",
    rootCause: "ERP-SAP exports web-optimized assets, not print-resolution originals.",
    fixPath: "Upscale pipeline can reach 2000×2000 at 76% confidence. Below the auto-approve bar — a human should eyeball the result.",
    resolution: "manual", confidence: 76, field: "primary_image_url", revenueUsd: 2800, daysOffline: 3, status: "new", recurrence: 5, owner: "Priya Raman",
  },
];

export const RESOLVED_LOG = [
  { id: "rl-001", retailer: "Walmart", sku: "GD-FERT-ORG-5LB", field: "npk_ratio", resolvedAt: "2026-07-25", days: 1, method: "auto" as Resolution, revenueUsd: 2400 },
  { id: "rl-002", retailer: "Amazon", sku: "CF-DRIP-ELITE-BLK", field: "product_type", resolvedAt: "2026-07-24", days: 2, method: "assisted" as Resolution, revenueUsd: 1800 },
  { id: "rl-003", retailer: "Target", sku: "CF-DRIP-ELITE-BLK", field: "bullet_points", resolvedAt: "2026-07-22", days: 3, method: "assisted" as Resolution, revenueUsd: 3200 },
  { id: "rl-004", retailer: "Home Depot", sku: "GD-FERT-ORG-5LB", field: "specifications", resolvedAt: "2026-07-20", days: 1, method: "auto" as Resolution, revenueUsd: 1500 },
];
