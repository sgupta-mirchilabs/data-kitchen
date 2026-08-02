// Delivery dataset + payload builder — transforms catalog products into
// retailer-shaped records using the approved mappings from Mapping Studio.

import { PRODUCTS, type Product } from "./seed-data";

export interface DeliveryRecord {
  history: string;
}

export interface DeliveryHistoryEntry {
  id: string;
  retailer: string;
  format: string;
  skuCount: number;
  fileName: string;
  sizeKb: number;
  deliveredAt: string;
  status: "accepted" | "partial" | "rejected" | "processing";
  note?: string;
  deliveredBy: string;
}

export const HISTORY: DeliveryHistoryEntry[] = [
  { id: "d-006", retailer: "Amazon", format: "Flat File (XLSX)", skuCount: 4, fileName: "amazon_catalog_2026-07-30.xlsx", sizeKb: 84, deliveredAt: "2026-07-30T16:20:00Z", status: "partial", note: "2 of 4 SKUs suppressed — title length", deliveredBy: "Maria Chen" },
  { id: "d-005", retailer: "Walmart", format: "CSV", skuCount: 5, fileName: "walmart_item_setup_2026-07-30.csv", sizeKb: 42, deliveredAt: "2026-07-30T11:05:00Z", status: "accepted", deliveredBy: "Automated" },
  { id: "d-004", retailer: "Target", format: "Portal Package (ZIP)", skuCount: 3, fileName: "target_partners_2026-07-29.zip", sizeKb: 2140, deliveredAt: "2026-07-29T09:44:00Z", status: "rejected", note: "Missing waterproof + care_instructions", deliveredBy: "James Okafor" },
  { id: "d-003", retailer: "Home Depot", format: "JSON (API)", skuCount: 2, fileName: "POST /vendor/v3/items", sizeKb: 18, deliveredAt: "2026-07-28T15:12:00Z", status: "rejected", note: "ERR_COMPLIANCE_PROP65", deliveredBy: "Automated" },
  { id: "d-002", retailer: "Walmart", format: "CSV", skuCount: 6, fileName: "walmart_item_setup_2026-07-25.csv", sizeKb: 49, deliveredAt: "2026-07-25T08:30:00Z", status: "accepted", deliveredBy: "Automated" },
  { id: "d-001", retailer: "Costco", format: "Portal Package (ZIP)", skuCount: 2, fileName: "costco_vendor_2026-07-22.zip", sizeKb: 1680, deliveredAt: "2026-07-22T13:00:00Z", status: "accepted", deliveredBy: "Sudu Gupta" },
];

// ─── Payload construction ─────────────────────────────────────────────────────

const attr = (p: Product, key: string): string => {
  const a = p.attributes[key];
  if (!a || a.value === null || a.value === undefined) return "";
  return a.unit ? `${a.value} ${a.unit}` : String(a.value);
};

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

const cleanTitle = (p: Product) =>
  (p.attributes.title?.value as string ?? p.name).replace(/\s—\s.*(Collection|Exclusive)[^,]*/i, "").trim();

export interface RetailerSchema {
  id: string;
  columns: string[];
  /** Subset of columns the retailer will hard-reject on if blank */
  required: string[];
  build: (p: Product) => Record<string, string>;
}

export const SCHEMAS: Record<string, RetailerSchema> = {
  walmart: {
    id: "walmart",
    columns: ["gtin14", "productName", "brand", "shortDescription", "itemWeight", "countryOfOrigin", "color", "mainImageUrl"],
    required: ["gtin14", "productName", "brand", "itemWeight", "countryOfOrigin", "mainImageUrl"],
    build: p => ({
      gtin14: p.gtin,
      productName: truncate(cleanTitle(p), 200),
      brand: attr(p, "brand"),
      shortDescription: truncate(cleanTitle(p), 120),
      itemWeight: p.attributes.weight?.value != null ? `${(Number(p.attributes.weight.value) * 16).toFixed(2)} oz` : "",
      countryOfOrigin: attr(p, "country_of_origin"),
      color: p.name.match(/Black|White|Navy|Stainless/i)?.[0] ?? "",
      mainImageUrl: p.images.find(i => i.type === "hero")?.compliant ? `https://cdn.mirchi.io/wmt/${p.sku.toLowerCase()}-hero.jpg` : "",
    }),
  },
  target: {
    id: "target",
    columns: ["tcin", "title", "brand", "material", "waterproof", "careInstructions", "countryOfOrigin"],
    required: ["tcin", "title", "brand", "countryOfOrigin"],
    build: p => ({
      tcin: p.gtin.slice(-8),
      title: truncate(cleanTitle(p), 150),
      brand: attr(p, "brand"),
      material: attr(p, "material").split(" ")[1] ?? attr(p, "material"),
      waterproof: p.attributes.waterproof ? "true" : "",
      careInstructions: p.category === "Apparel" ? "Machine wash cold, tumble dry low" : "",
      countryOfOrigin: attr(p, "country_of_origin"),
    }),
  },
  amazon: {
    id: "amazon",
    columns: ["external_product_id", "item_name", "brand_name", "product_type", "bullet_point1", "generic_keywords"],
    required: ["external_product_id", "item_name", "brand_name", "product_type"],
    build: p => ({
      external_product_id: p.gtin.replace(/^0+/, ""),
      item_name: truncate(cleanTitle(p), 200),
      brand_name: attr(p, "brand"),
      product_type: p.subCategory.split(" > ").pop()?.toUpperCase().replace(/\s+/g, "_") ?? "",
      bullet_point1: `${attr(p, "brand")} ${p.subCategory.split(" > ").pop()} — ${p.category}`,
      generic_keywords: `${attr(p, "brand")} ${p.subCategory.split(" > ").join(" ")}`.toLowerCase(),
    }),
  },
  homedepot: {
    id: "homedepot",
    columns: ["modelNumber", "manufacturer", "title", "vocContent", "caProp65Warning"],
    required: ["modelNumber", "manufacturer", "title"],
    build: p => ({
      modelNumber: p.sku.split("-").slice(1).join("-"),
      manufacturer: attr(p, "brand"),
      title: truncate(cleanTitle(p), 100),
      vocContent: attr(p, "voc_content") ? `${attr(p, "voc_content")} g/L` : "",
      caProp65Warning: p.attributes.voc_content
        ? "WARNING: This product can expose you to Ethylbenzene, known to the State of California to cause cancer. www.P65Warnings.ca.gov"
        : "",
    }),
  },
  costco: {
    id: "costco",
    columns: ["itemNumber", "description", "brand", "netWeight", "unitCount", "noiseLevel"],
    required: ["itemNumber", "description", "brand", "netWeight"],
    build: p => ({
      itemNumber: p.gtin.slice(-7),
      description: truncate(cleanTitle(p), 65),
      brand: attr(p, "brand"),
      netWeight: attr(p, "weight"),
      unitCount: "1",
      noiseLevel: attr(p, "noise_db"),
    }),
  },
};

export const FORMATS = [
  { id: "csv", label: "CSV", ext: "csv", desc: "Flat file for bulk item setup", icon: "table" },
  { id: "json", label: "JSON", ext: "json", desc: "Structured payload for API ingest", icon: "braces" },
  { id: "xlsx", label: "Excel", ext: "xlsx", desc: "Retailer flat-file template", icon: "sheet" },
  { id: "zip", label: "Portal Package", ext: "zip", desc: "Data + images + manifest", icon: "package" },
  { id: "api", label: "Direct API", ext: "", desc: "Push straight to vendor endpoint", icon: "cloud" },
] as const;

export type FormatId = (typeof FORMATS)[number]["id"];

// Which SKUs clear the bar for a given retailer
export function shippable(retailerId: string) {
  const schema = SCHEMAS[retailerId];
  return PRODUCTS.map(p => {
    const rec = schema.build(p);
    const missing = schema.required.filter(c => !rec[c]);
    return { product: p, record: rec, missing, ready: missing.length === 0 };
  });
}

export function toCsv(retailerId: string, rows: Record<string, string>[]): string {
  const cols = SCHEMAS[retailerId].columns;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c] ?? "")).join(","))].join("\n");
}

export function toJson(rows: Record<string, string>[]): string {
  return JSON.stringify(rows.slice(0, 2), null, 2);
}
