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
  return {
    port: optionalInt("PORT", 3001),
    host: optional("HOST", "0.0.0.0"),
    nodeEnv: optional("NODE_ENV", "development"),

    databaseUrl: required("DATABASE_URL"),

    defaultOrgId: optional("DEFAULT_ORG_ID", "00000000-0000-0000-0000-000000000001"),
    defaultUser: optional("DEFAULT_USER", "system"),

    storage: {
      provider: optional("STORAGE_PROVIDER", "local") as "azure" | "local",
      azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
      azureContainer: optional("AZURE_STORAGE_CONTAINER", "imports"),
      localBasePath: optional("LOCAL_STORAGE_PATH", "./uploads"),
    },

    upload: {
      maxFileSizeMb: optionalInt("MAX_UPLOAD_SIZE_MB", 50),
      maxImportRows: optionalInt("MAX_IMPORT_ROWS", 10000),
    },

    cors: {
      origin: optional("CORS_ORIGIN", "http://localhost:5173"),
    },
  } as const;
}

export type AppConfig = ReturnType<typeof loadConfig>;
