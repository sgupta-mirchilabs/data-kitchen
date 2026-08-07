import { api } from "./api-client";
import { PRODUCTS, CATALOG_STATS, type Product } from "./seed-data";

export interface CatalogProduct {
  id: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  productName: string | null;
  category: string | null;
  lifecycleStatus: string;
  dataQualityStatus: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogStats {
  totalProducts: number;
  productsWithSku: number;
  productsWithGtin: number;
  missingCoreFields: number;
  lastImport: { id: string; filename: string; uploadedAt: string } | null;
  sourceSystems: string[];
  byQuality: Record<string, number>;
}

export interface ImportBatch {
  id: string;
  filename: string;
  fileType: string;
  sourceSystem: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  status: string;
  totalRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  detectedHeaders: string[] | null;
  fieldMappings: Record<string, string> | null;
}

export interface SourceRecord {
  id: string;
  rowNumber: number;
  sourceRecordKey: string | null;
  rawPayloadJson: Record<string, unknown>;
  parseStatus: string;
  parseErrorsJson: unknown;
  createdAt: string;
  importBatch?: { filename: string; sourceSystem: string | null; uploadedAt: string };
}

export interface ProvenanceRecord {
  id: string;
  canonicalField: string;
  sourceField: string;
  originalValue: string | null;
  normalizedValue: string | null;
  normalizationMethod: string | null;
  createdAt: string;
  sourceRecord?: { importBatch: { filename: string; sourceSystem: string | null } };
}

export interface HistoryRecord {
  id: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  sourceRecordId: string | null;
  actor: string | null;
  createdAt: string;
}

export interface CatalogRepository {
  mode: "demo" | "live";
  getCatalogs(): Promise<Array<{ id: string; name: string; catalogType?: string }>>;
  getCatalogStats(catalogId: string): Promise<CatalogStats>;
  getProducts(catalogId: string, options?: { page?: number; status?: string; search?: string }): Promise<{ products: CatalogProduct[]; total: number }>;
  getProduct(productId: string): Promise<CatalogProduct | null>;
  getSourceRecords(productId: string): Promise<SourceRecord[]>;
  getProvenance(productId: string): Promise<ProvenanceRecord[]>;
  getHistory(productId: string): Promise<HistoryRecord[]>;
  getImports(catalogId: string): Promise<ImportBatch[]>;
}

class DemoCatalogRepository implements CatalogRepository {
  mode = "demo" as const;

  async getCatalogs() {
    return [{ id: "demo", name: "Demo Catalog", catalogType: "test" }];
  }

  async getCatalogStats(): Promise<CatalogStats> {
    return {
      totalProducts: CATALOG_STATS.totalProducts,
      productsWithSku: PRODUCTS.filter((p) => p.sku).length,
      productsWithGtin: PRODUCTS.filter((p) => p.gtin).length,
      missingCoreFields: 0,
      lastImport: { id: "demo", filename: CATALOG_STATS.sourceFile, uploadedAt: CATALOG_STATS.importDate },
      sourceSystems: [...new Set(PRODUCTS.map((p) => p.sourceSystem))],
      byQuality: {},
    };
  }

  async getProducts(_catalogId: string, options?: { status?: string; search?: string }): Promise<{ products: CatalogProduct[]; total: number }> {
    let mapped = PRODUCTS.map(demoProductToCanonical);
    if (options?.status && options.status !== "all") {
      mapped = mapped.filter((p) => p.dataQualityStatus === options.status);
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      mapped = mapped.filter((p) =>
        (p.productName ?? "").toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s) || (p.brand ?? "").toLowerCase().includes(s),
      );
    }
    return {
      products: mapped,
      total: mapped.length,
    };
  }

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    const p = PRODUCTS.find((p) => p.id === productId);
    return p ? demoProductToCanonical(p) : null;
  }

  async getSourceRecords(): Promise<SourceRecord[]> { return []; }
  async getProvenance(): Promise<ProvenanceRecord[]> { return []; }
  async getHistory(): Promise<HistoryRecord[]> { return []; }
  async getImports(): Promise<ImportBatch[]> { return []; }
}

function demoProductToCanonical(p: Product): CatalogProduct {
  return {
    id: p.id,
    sku: p.sku,
    gtin: p.gtin,
    brand: p.brand,
    productName: p.name,
    category: p.category,
    lifecycleStatus: "draft",
    dataQualityStatus: p.status === "ready" ? "complete" : p.status === "blocked" ? "missing_core_fields" : p.status,
    attributes: p.attributes as unknown as Record<string, unknown>,
    createdAt: p.lastModified,
    updatedAt: p.lastModified,
  };
}

class ApiCatalogRepository implements CatalogRepository {
  mode = "live" as const;

  async getCatalogs() {
    const res = await api.get<Array<{ id: string; name: string; catalogType?: string }>>("/catalogs");
    return res.data;
  }

  async getCatalogStats(catalogId: string): Promise<CatalogStats> {
    const res = await api.get<{ stats: CatalogStats }>(`/catalogs/${catalogId}`);
    return res.data.stats;
  }

  async getProducts(catalogId: string, options?: { page?: number; status?: string; search?: string }) {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", String(options.page));
    if (options?.status && options.status !== "all") params.set("status", options.status);
    if (options?.search) params.set("search", options.search);
    const qs = params.toString();
    const res = await api.get<CatalogProduct[]>(`/catalogs/${catalogId}/products${qs ? `?${qs}` : ""}`);
    return { products: res.data, total: res.meta?.total ?? res.data.length };
  }

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    try {
      const res = await api.get<CatalogProduct>(`/products/${productId}`);
      return res.data;
    } catch {
      return null;
    }
  }

  async getSourceRecords(productId: string) {
    const res = await api.get<SourceRecord[]>(`/products/${productId}/source-records`);
    return res.data;
  }

  async getProvenance(productId: string) {
    const res = await api.get<ProvenanceRecord[]>(`/products/${productId}/provenance`);
    return res.data;
  }

  async getHistory(productId: string) {
    const res = await api.get<HistoryRecord[]>(`/products/${productId}/history`);
    return res.data;
  }

  async getImports(catalogId: string) {
    const res = await api.get<ImportBatch[]>(`/catalogs/${catalogId}/imports`);
    return res.data;
  }
}

let cachedRepo: CatalogRepository | null = null;

export async function getCatalogRepository(): Promise<CatalogRepository> {
  if (cachedRepo) return cachedRepo;

  if (import.meta.env.VITE_FORCE_DEMO === "true") {
    cachedRepo = new DemoCatalogRepository();
    return cachedRepo;
  }

  const backendAvailable = await api.healthCheck();
  cachedRepo = backendAvailable ? new ApiCatalogRepository() : new DemoCatalogRepository();
  return cachedRepo;
}

export function resetCatalogRepository() {
  cachedRepo = null;
}
