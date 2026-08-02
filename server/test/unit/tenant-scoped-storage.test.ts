import { describe, it, expect } from "vitest";
import {
  buildTenantStorageKey,
  createTenantScopedStorage,
} from "../../src/storage/tenant-scoped-storage.js";
import type { StorageProvider } from "../../src/storage/storage.interface.js";

const ORG_A = "org-aaa";
const ORG_B = "org-bbb";

function makeFakeStorage(): StorageProvider & { uploaded: string[] } {
  const uploaded: string[] = [];
  return {
    uploaded,
    async upload(key: string, _data: Buffer, _contentType?: string) {
      uploaded.push(key);
    },
    async download(_key: string) {
      return Buffer.from("data");
    },
    async exists(_key: string) {
      return true;
    },
    getUrl(key: string) {
      return `https://fake/${key}`;
    },
  };
}

describe("buildTenantStorageKey", () => {
  it("produces org-prefixed key", () => {
    const key = buildTenantStorageKey("org-1", "cat-1", "imp-1", "data.csv");
    expect(key).toBe("organizations/org-1/catalogs/cat-1/imports/imp-1/data.csv");
  });

  it("sanitizes slashes and backslashes in filename", () => {
    const key = buildTenantStorageKey("org-1", "cat-1", "imp-1", "sub/dir\\file.csv");
    expect(key).not.toMatch(/sub\/dir/);
    expect(key).toContain("sub_dir_file.csv");
  });

  it("rejects path traversal from non-filename parameters", () => {
    expect(() =>
      buildTenantStorageKey("org-1", "../evil", "imp-1", "data.csv"),
    ).toThrow();
  });

  it("sanitizes control characters in filename", () => {
    const key = buildTenantStorageKey("org-1", "cat-1", "imp-1", "file\x00name.csv");
    expect(key).not.toContain("\x00");
    expect(key).toContain("file_name.csv");
  });
});

describe("createTenantScopedStorage", () => {
  it("allows upload to own org prefix", async () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);
    const key = `organizations/${ORG_A}/catalogs/c1/imports/i1/file.csv`;

    await scoped.upload(key, Buffer.from("csv"), "text/csv");
    expect(base.uploaded).toContain(key);
  });

  it("rejects upload to a different org prefix", async () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);
    const key = `organizations/${ORG_B}/catalogs/c1/imports/i1/file.csv`;

    await expect(scoped.upload(key, Buffer.from("csv"), "text/csv")).rejects.toThrow(
      "Storage key outside tenant scope",
    );
  });

  it("rejects download outside tenant scope", async () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);

    await expect(
      scoped.download(`organizations/${ORG_B}/catalogs/c1/file.csv`),
    ).rejects.toThrow("Storage key outside tenant scope");
  });

  it("rejects exists check outside tenant scope", async () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);

    await expect(
      scoped.exists(`organizations/${ORG_B}/catalogs/c1/file.csv`),
    ).rejects.toThrow("Storage key outside tenant scope");
  });

  it("rejects getUrl outside tenant scope", () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);

    expect(() =>
      scoped.getUrl(`organizations/${ORG_B}/catalogs/c1/file.csv`),
    ).toThrow("Storage key outside tenant scope");
  });

  it("rejects key with no org prefix at all", async () => {
    const base = makeFakeStorage();
    const scoped = createTenantScopedStorage(base, ORG_A);

    await expect(
      scoped.download("raw-key/file.csv"),
    ).rejects.toThrow("Storage key outside tenant scope");
  });
});
