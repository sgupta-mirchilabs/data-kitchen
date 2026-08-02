import type { AppConfig } from "../config.js";
import type { StorageProvider } from "./storage.interface.js";
import { AzureBlobStorage } from "./azure-blob.storage.js";
import { LocalFsStorage } from "./local-fs.storage.js";

export function createStorageProvider(config: AppConfig["storage"]): StorageProvider {
  if (config.provider === "azure") {
    if (!config.azureConnectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_PROVIDER=azure");
    }
    return new AzureBlobStorage(config.azureConnectionString, config.azureContainer);
  }
  return new LocalFsStorage(config.localBasePath);
}
