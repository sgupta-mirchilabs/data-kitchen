import { BlobServiceClient } from "@azure/storage-blob";
import type { StorageProvider } from "./storage.interface.js";
import { StorageError } from "../errors/api-errors.js";

export class AzureBlobStorage implements StorageProvider {
  private client: BlobServiceClient;
  private containerName: string;

  constructor(connectionString: string, containerName: string) {
    this.client = BlobServiceClient.fromConnectionString(connectionString);
    this.containerName = containerName;
  }

  private get container() {
    return this.client.getContainerClient(this.containerName);
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    try {
      const container = this.container;
      await container.createIfNotExists();
      const blob = container.getBlockBlobClient(key);
      await blob.upload(data, data.length, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    } catch (err) {
      throw new StorageError(`Failed to upload ${key}`, {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const blob = this.container.getBlockBlobClient(key);
      const response = await blob.downloadToBuffer();
      return response;
    } catch (err) {
      throw new StorageError(`Failed to download ${key}`, {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const blob = this.container.getBlockBlobClient(key);
      return await blob.exists();
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    const blob = this.container.getBlockBlobClient(key);
    return blob.url;
  }
}
