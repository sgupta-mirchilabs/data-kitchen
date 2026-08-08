function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  return n;
}

export function loadConfig() {
  const nodeEnv = optional("NODE_ENV", "development");
  const isProduction = nodeEnv === "production";
  const authMode = optional("AUTH_MODE", "development") as
    | "development"
    | "production"
    | "entra";

  if (authMode === "development" && isProduction) {
    throw new Error(
      "AUTH_MODE=development cannot be used when NODE_ENV=production. " +
      "Set AUTH_MODE=entra for cloud deployments.",
    );
  }

  if (authMode === "production") {
    if (!process.env.AUTH_ISSUER) throw new Error("Production auth requires AUTH_ISSUER");
    if (!process.env.AUTH_AUDIENCE) throw new Error("Production auth requires AUTH_AUDIENCE");
    if (!process.env.AUTH_JWKS_URI) throw new Error("Production auth requires AUTH_JWKS_URI");
  }

  if (authMode === "entra") {
    if (!process.env.ENTRA_TENANT_ID) {
      throw new Error("AUTH_MODE=entra requires ENTRA_TENANT_ID");
    }
    if (!process.env.ENTRA_API_CLIENT_ID) {
      throw new Error("AUTH_MODE=entra requires ENTRA_API_CLIENT_ID");
    }
    if (process.env.DEV_AUTH_TOKEN) {
      throw new Error(
        "DEV_AUTH_TOKEN must not be set when AUTH_MODE=entra. " +
        "The development token is for local development and integration tests only.",
      );
    }
  }

  let devAuthToken: string | undefined;
  if (authMode === "development") {
    devAuthToken = process.env.DEV_AUTH_TOKEN;
    if (!devAuthToken) {
      throw new Error("DEV_AUTH_TOKEN is required when AUTH_MODE=development");
    }
  }

  const originsRaw = isProduction
    ? required("ALLOWED_ORIGINS")
    : optional("ALLOWED_ORIGINS", "http://localhost:5173");
  const origins = originsRaw.split(",").map((o) => o.trim()).filter(Boolean);

  if (isProduction && origins.includes("*")) {
    throw new Error("Wildcard CORS origin (*) is not allowed in production");
  }

  const storageProvider = optional("STORAGE_PROVIDER", "local") as "azure" | "local";
  if (storageProvider === "azure") {
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_PROVIDER=azure");
    }
  }

  return {
    port: optionalInt("PORT", 3001),
    host: optional("HOST", "0.0.0.0"),
    nodeEnv,

    databaseUrl: required("DATABASE_URL"),

    auth: {
      mode: authMode,
      devAuthToken,
      issuer: process.env.AUTH_ISSUER,
      audience: process.env.AUTH_AUDIENCE,
      jwksUri: process.env.AUTH_JWKS_URI,
      entraTenantId: process.env.ENTRA_TENANT_ID,
      entraApiClientId: process.env.ENTRA_API_CLIENT_ID,
    },

    storage: {
      provider: storageProvider,
      azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
      azureContainer: optional("AZURE_STORAGE_CONTAINER", "imports"),
      localBasePath: optional("LOCAL_STORAGE_PATH", "./uploads"),
    },

    upload: {
      maxFileSizeMb: optionalInt("MAX_UPLOAD_SIZE_MB", 50),
      maxImportRows: optionalInt("MAX_IMPORT_ROWS", 10000),
    },

    imports: {
      /** How often the worker looks for queued work. */
      pollIntervalMs: optionalInt("IMPORT_POLL_INTERVAL_MS", 2000),
      /** Lease validity without a heartbeat; an expired lease is reclaimable. */
      leaseMs: optionalInt("IMPORT_LEASE_MS", 60000),
      /** Rows between progress/heartbeat/cancellation checkpoints. */
      chunkSize: optionalInt("IMPORT_CHUNK_SIZE", 100),
    },

    cors: {
      origins,
    },
  } as const;
}

export type AppConfig = ReturnType<typeof loadConfig>;
