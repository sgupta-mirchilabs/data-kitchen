import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageProvider } from "./storage.interface.js";
import { StorageError } from "../errors/api-errors.js";

export class LocalFsStorage implements StorageProvider {
  constructor(private basePath: string) {}

  private resolvePath(key: string): string {
    return join(this.basePath, key);
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<void> {
    try {
      const filePath = this.resolvePath(key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    } catch (err) {
      throw new StorageError(`Failed to write ${key}`, {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err) {
      throw new StorageError(`Failed to read ${key}`, {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `file://${this.resolvePath(key)}`;
  }
}
