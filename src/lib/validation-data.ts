// Validation & Exceptions dataset — extends the base EXCEPTIONS from seed-data
// with numeric revenue impact, auto-heal eligibility, and detection source.

import { EXCEPTIONS, type ValidationException } from "./seed-data";

export type DetectedBy = "schema" | "retailer_api" | "compliance" | "image_qa";

export interface EnrichedException extends ValidationException {
  revenueUsd: number;
  autoHealEligible: boolean;
  detectedBy: DetectedBy;
}

export const DETECTED_META: Record<DetectedBy, { label: string; color: string }> = {
  schema: { label: "Schema Check", color: "var(--blue)" },
  retailer_api: { label: "Retailer API", color: "var(--amber)" },
  compliance: { label: "Compliance Rule", color: "var(--red)" },
  image_qa: { label: "Image QA", color: "var(--purple)" },
};

// Revenue + heal metadata for the five base exceptions
const BASE_META: Record<string, { revenueUsd: number; autoHealEligible: boolean; detectedBy: DetectedBy }> = {
  "exc-001": { revenueUsd: 4200, autoHealEligible: true, detectedBy: "retailer_api" },
  "exc-002": { revenueUsd: 8100, autoHealEligible: true, detectedBy: "retailer_api" },
  "exc-003": { revenueUsd: 6400, autoHealEligible: true, detectedBy: "retailer_api" },
  "exc-004": { revenueUsd: 12500, autoHealEligible: true, detectedBy: "compliance" },
  "exc-005": { revenueUsd: 3100, autoHealEligible: true, detectedBy: "schema" },
};

const EXTRA: EnrichedException[] = [
  {
    id: "exc-006", productId: "prod-002", productName: "SoundGear ProMax Wireless Headphones", sku: "SG-HDPH-PRO-MAX-WHT",
    channel: "Amazon", errorCode: "ERR_ATTR_MISSING_NC", errorType: "missing_attribute", severity: "error",
    field: "noise_cancellation", currentValue: null, proposedFix: "Active Noise Cancellation (ANC)",
    aiConfidence: 88, sourceDocument: "SoundGear_ProMax_TechSpec.pdf", status: "open",
    revenueImpact: "Blocks Amazon Headphones product type", createdAt: "2026-07-29T10:20:00Z",
    revenueUsd: 5300, autoHealEligible: true, detectedBy: "schema",
  },
  {
    id: "exc-007", productId: "prod-004", productName: "ProTech UltraShield Exterior Paint", sku: "PT-PAINT-ULTRA-GAL-NVY",
    channel: "Home Depot", errorCode: "ERR_IMG_RESOLUTION", errorType: "image_issue", severity: "error",
    field: "primary_image_url", currentValue: "1200×1200 · 720 KB", proposedFix: "Upscale to 2000×2000 via image pipeline · re-encode at 85% quality",
    aiConfidence: 76, status: "open", assignedTo: "Priya Raman",
    revenueImpact: "Hero image below Home Depot minimum", createdAt: "2026-07-29T18:10:00Z",
    revenueUsd: 2800, autoHealEligible: false, detectedBy: "image_qa",
  },
  {
    id: "exc-008", productId: "prod-001", productName: "NorthFace APEX Flex GTX 2.0 Jacket", sku: "NF-JKT-APEX-M-BLK",
    channel: "Target", errorCode: "ERR_ATTR_MISSING_CARE", errorType: "missing_attribute", severity: "error",
    field: "care_instructions", currentValue: null, proposedFix: "Machine wash cold, tumble dry low, do not iron, do not dry clean",
    aiConfidence: 81, sourceDocument: "NorthFace_CareGuide_Outerwear.pdf", status: "open",
    revenueImpact: "Required for Target Apparel category", createdAt: "2026-07-27T12:40:00Z",
    revenueUsd: 3600, autoHealEligible: true, detectedBy: "schema",
  },
  {
    id: "exc-009", productId: "prod-005", productName: "Luxe Pro Series Commercial Blender", sku: "LX-BLNDR-PRO-1500",
    channel: "Costco", errorCode: "WARN_UNIT_COUNT", errorType: "missing_attribute", severity: "warning",
    field: "unit_count", currentValue: null, proposedFix: "1 (single unit)",
    aiConfidence: 71, status: "open",
    revenueImpact: "Pack configuration unconfirmed", createdAt: "2026-07-31T09:05:00Z",
    revenueUsd: 900, autoHealEligible: false, detectedBy: "schema",
  },
  {
    id: "exc-010", productId: "prod-006", productName: "CraftBrew Elite Drip Coffee Maker", sku: "CF-DRIP-ELITE-BLK",
    channel: "Costco", errorCode: "WARN_DESC_LENGTH", errorType: "exceeds_limit", severity: "warning",
    field: "description", currentValue: "CraftBrew Elite 12-Cup Drip Coffee Maker, Matte Black (53 chars)",
    proposedFix: "CraftBrew Elite 12-Cup Drip Coffee Maker, Black (47 chars)",
    aiConfidence: 94, status: "open",
    revenueImpact: "Within limit but flagged for consistency", createdAt: "2026-07-31T10:15:00Z",
    revenueUsd: 400, autoHealEligible: true, detectedBy: "schema",
  },
  {
    id: "exc-011", productId: "prod-002", productName: "SoundGear ProMax Wireless Headphones", sku: "SG-HDPH-PRO-MAX-WHT",
    channel: "Amazon", errorCode: "WARN_IMG_COUNT", errorType: "image_issue", severity: "warning",
    field: "other_image_url", currentValue: "1 image on file", proposedFix: "Request 5 alternate angles from brand asset library",
    aiConfidence: 0, status: "open", assignedTo: "Priya Raman",
    revenueImpact: "Conversion drag — Amazon recommends 6 images", createdAt: "2026-07-30T14:00:00Z",
    revenueUsd: 1900, autoHealEligible: false, detectedBy: "image_qa",
  },
  {
    id: "exc-012", productId: "prod-004", productName: "ProTech UltraShield Exterior Paint", sku: "PT-PAINT-ULTRA-GAL-NVY",
    channel: "Walmart", errorCode: "ERR_ATTR_MISSING_WARRANTY", errorType: "missing_attribute", severity: "warning",
    field: "warranty", currentValue: null, proposedFix: "15-Year Limited Warranty",
    aiConfidence: 69, sourceDocument: "ProTech_Warranty_Terms_2026.pdf", status: "open",
    revenueImpact: "Optional field — improves listing quality score", createdAt: "2026-07-29T16:55:00Z",
    revenueUsd: 700, autoHealEligible: false, detectedBy: "schema",
  },
];

export const ALL_EXCEPTIONS: EnrichedException[] = [
  ...EXCEPTIONS.map((e: ValidationException) => ({ ...e, ...BASE_META[e.id] })),
  ...EXTRA,
];

export const TEAM = ["Maria Chen", "James Okafor", "Priya Raman", "Sudu Gupta"];
