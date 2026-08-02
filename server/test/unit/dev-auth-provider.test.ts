import { describe, it, expect } from "vitest";
import { DevAuthProvider } from "../../src/auth/dev-auth-provider.js";

const VALID_TOKEN = "test-secret-token-123";

describe("DevAuthProvider", () => {
  it("returns the seeded dev user for the correct token", async () => {
    const provider = new DevAuthProvider(VALID_TOKEN);
    const user = await provider.validateToken(VALID_TOKEN);

    expect(user.externalId).toBe("dev-user-001");
    expect(user.email).toBe("dev@datakitchen.local");
    expect(user.displayName).toBe("Development User");
    expect(user.rawClaims).toEqual({});
  });

  it("rejects an incorrect token", async () => {
    const provider = new DevAuthProvider(VALID_TOKEN);

    await expect(provider.validateToken("wrong-token")).rejects.toThrow(
      "Invalid development token",
    );
  });

  it("rejects an empty token", async () => {
    const provider = new DevAuthProvider(VALID_TOKEN);

    await expect(provider.validateToken("")).rejects.toThrow(
      "Invalid development token",
    );
  });

  it("rejects a missing token", async () => {
    const provider = new DevAuthProvider(VALID_TOKEN);

    await expect(
      provider.validateToken(undefined as unknown as string),
    ).rejects.toThrow("Invalid development token");
  });
});
