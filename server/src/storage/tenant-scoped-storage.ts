import type { StorageProvider } from "./storage.interface.js";
import { AppError } from "../errors/api-errors.js";

function validateStorageKey(key: string): void {
  if (key.includes("..")) {
    throw new AppError(400, "INVALID_KEY", "Path traversal not allowed");
  }
  if (/[\x00-\x1f]/.test(key)) {
    throw new AppError(400, "INVALID_KEY", "Control characters not allowed in storage key");
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\:\x00-\x1f]/g, "_");
}

export function buildTenantStorageKey(
  organizationId: string,
  catalogId: string,
  importId: string,
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  const key = `organizations/${organizationId}/catalogs/${catalogId}/imports/${importId}/${safe}`;
  validateStorageKey(key);
  return key;
}

export function createTenantScopedStorage(
  provider: StorageProvider,
  organizationId: string,
): StorageProvider {
  const orgPrefix = `organizations/${organizationId}/`;

  function assertOwned(key: string): void {
    if (!key.startsWith(orgPrefix)) {
      throw new AppError(403, "FORBIDDEN", "Storage key outside tenant scope");
    }
  }

  return {
    async upload(key, data, contentType) {
      validateStorageKey(key);
      assertOwned(key);
      return provider.upload(key, data, contentType);
    },
    async download(key) {
      assertOwned(key);
      return provider.download(key);
    },
    async exists(key) {
      assertOwned(key);
      return provider.exists(key);
    },
    getUrl(key) {
      assertOwned(key);
      return provider.getUrl(key);
    },
  };
}
