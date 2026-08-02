import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig auth safety", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows AUTH_MODE=development when NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_MODE = "development";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.DEV_AUTH_TOKEN = "test-token";

    const config = loadConfig();
    expect(config.auth.mode).toBe("development");
    expect(config.auth.devAuthToken).toBe("test-token");
  });

  it("throws when AUTH_MODE=development and NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "development";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.DEV_AUTH_TOKEN = "test-token";

    expect(() => loadConfig()).toThrow(
      "AUTH_MODE=development cannot be used when NODE_ENV=production",
    );
  });

  it("throws when AUTH_MODE=production without required vars", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_MODE = "production";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    delete process.env.AUTH_ISSUER;

    expect(() => loadConfig()).toThrow("Production auth requires AUTH_ISSUER");
  });

  it("defaults AUTH_MODE to development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.AUTH_MODE;
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.DEV_AUTH_TOKEN = "test-token";

    const config = loadConfig();
    expect(config.auth.mode).toBe("development");
  });

  it("throws when DEV_AUTH_TOKEN is missing in development mode", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_MODE = "development";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    delete process.env.DEV_AUTH_TOKEN;

    expect(() => loadConfig()).toThrow(
      "DEV_AUTH_TOKEN is required when AUTH_MODE=development",
    );
  });

  it("rejects wildcard CORS in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "production";
    process.env.DATABASE_URL = "postgresql://prod-host/db";
    process.env.ALLOWED_ORIGINS = "*";
    process.env.AUTH_ISSUER = "https://issuer.example.com";
    process.env.AUTH_AUDIENCE = "api://test";
    process.env.AUTH_JWKS_URI = "https://issuer.example.com/.well-known/jwks";

    expect(() => loadConfig()).toThrow(
      "Wildcard CORS origin (*) is not allowed in production",
    );
  });

  it("requires ALLOWED_ORIGINS in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "production";
    process.env.DATABASE_URL = "postgresql://prod-host/db";
    delete process.env.ALLOWED_ORIGINS;
    process.env.AUTH_ISSUER = "https://issuer.example.com";
    process.env.AUTH_AUDIENCE = "api://test";
    process.env.AUTH_JWKS_URI = "https://issuer.example.com/.well-known/jwks";

    expect(() => loadConfig()).toThrow(
      "Missing required environment variable: ALLOWED_ORIGINS",
    );
  });

  it("requires AZURE_STORAGE_CONNECTION_STRING when STORAGE_PROVIDER=azure", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_MODE = "development";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.DEV_AUTH_TOKEN = "test-token";
    process.env.STORAGE_PROVIDER = "azure";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;

    expect(() => loadConfig()).toThrow(
      "AZURE_STORAGE_CONNECTION_STRING is required when STORAGE_PROVIDER=azure",
    );
  });
});
