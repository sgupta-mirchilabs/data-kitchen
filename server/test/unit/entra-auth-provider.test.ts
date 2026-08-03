import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import { createLocalJWKSet } from "jose";
import { EntraAuthProvider } from "../../src/auth/entra-auth-provider.js";

const TENANT_ID = "82719a05-0000-0000-0000-000000000001";
const API_CLIENT_ID = "69e29913-0000-0000-0000-000000000002";
const SPA_CLIENT_ID = "6414354f-0000-0000-0000-000000000003";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

let privateKey: KeyLike;
let publicJwk: JWK;
let foreignPrivateKey: KeyLike;

/** Mints a token signed by the trusted key, with overridable claims. */
async function mintToken(overrides: Record<string, unknown> = {}, key?: KeyLike) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    tid: TENANT_ID,
    oid: "user-object-id-1",
    name: "Sudu Gupta",
    preferred_username: "sgupta@mirchilabs.com",
    ...overrides,
  };

  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt(now)
    .setIssuer((overrides.iss as string) ?? ISSUER)
    .setAudience((overrides.aud as string) ?? API_CLIENT_ID)
    .setExpirationTime((overrides.exp as number) ?? now + 3600);

  return jwt.sign(key ?? privateKey);
}

function makeProvider() {
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  return new EntraAuthProvider({ tenantId: TENANT_ID, apiClientId: API_CLIENT_ID }, jwks);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as KeyLike;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test-key" };

  const foreign = await generateKeyPair("RS256");
  foreignPrivateKey = foreign.privateKey as KeyLike;
});

describe("EntraAuthProvider", () => {
  it("rejects an empty token", async () => {
    await expect(makeProvider().validateToken("")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a malformed token", async () => {
    await expect(makeProvider().validateToken("not-a-jwt")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects a token signed by an untrusted key", async () => {
    const token = await mintToken({}, foreignPrivateKey);
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a token from the wrong tenant (issuer mismatch)", async () => {
    const otherTenant = "99999999-0000-0000-0000-000000000009";
    const token = await mintToken({
      iss: `https://login.microsoftonline.com/${otherTenant}/v2.0`,
      tid: otherTenant,
    });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a token whose tid disagrees with the trusted issuer", async () => {
    // Correct issuer, but the tenant stamp says otherwise.
    const token = await mintToken({ tid: "11111111-0000-0000-0000-00000000000a" });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a token minted for a different audience", async () => {
    const token = await mintToken({ aud: "00000003-0000-0000-c000-000000000000" });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a token whose audience is the SPA registration, not the API", async () => {
    const token = await mintToken({ aud: SPA_CLIENT_ID });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Beyond the 60s clock tolerance.
    const token = await mintToken({ exp: now - 300 });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a token with no oid claim", async () => {
    const token = await mintToken({ oid: undefined });
    await expect(makeProvider().validateToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("accepts a valid Mirchi tenant token and maps claims", async () => {
    const token = await mintToken();
    const user = await makeProvider().validateToken(token);

    expect(user.externalId).toBe("user-object-id-1");
    expect(user.email).toBe("sgupta@mirchilabs.com");
    expect(user.displayName).toBe("Sudu Gupta");
  });

  it("accepts the api:// audience form", async () => {
    const token = await mintToken({ aud: `api://${API_CLIENT_ID}` });
    const user = await makeProvider().validateToken(token);
    expect(user.externalId).toBe("user-object-id-1");
  });

  it("falls back to preferred_username for displayName when name is absent", async () => {
    const token = await mintToken({ name: undefined });
    const user = await makeProvider().validateToken(token);
    expect(user.displayName).toBe("sgupta@mirchilabs.com");
  });

  it("does not leak token contents in the error message", async () => {
    const token = await mintToken({}, foreignPrivateKey);
    await expect(makeProvider().validateToken(token)).rejects.toSatisfy(
      (err: Error) => !err.message.includes(token),
    );
  });
});
