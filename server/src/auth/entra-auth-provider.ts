import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AuthProvider, AuthenticatedUser } from "./types.js";
import { AppError } from "../errors/api-errors.js";

export interface EntraAuthConfig {
  tenantId: string;
  apiClientId: string;
}

function unauthorized(): AppError {
  // Deliberately uniform: never reveal which validation step failed, and never
  // echo any part of the token back to the caller or the logs.
  return new AppError(401, "UNAUTHORIZED", "Invalid or expired token");
}

function firstString(payload: JWTPayload, ...claims: string[]): string | undefined {
  for (const claim of claims) {
    const value = payload[claim];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Validates Microsoft Entra ID v2.0 access tokens.
 *
 * Checks signature (against the tenant JWKS), issuer, audience, tenant, and
 * expiry. The audience is the `data-kitchen-api-dev` registration's client ID —
 * the SPA's client ID is never accepted.
 */
export class EntraAuthProvider implements AuthProvider {
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly tenantId: string;
  private readonly audiences: string[];

  constructor(config: EntraAuthConfig, jwks?: JWTVerifyGetKey) {
    this.tenantId = config.tenantId;
    this.issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
    // Tokens minted with requestedAccessTokenVersion=2 carry the bare client ID
    // as `aud`. The api:// form is accepted so a token-version regression on the
    // app registration surfaces as a working call rather than a silent outage.
    this.audiences = [config.apiClientId, `api://${config.apiClientId}`];
    this.jwks =
      jwks ??
      createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
      );
  }

  async validateToken(token: string): Promise<AuthenticatedUser> {
    if (!token) throw unauthorized();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audiences,
        algorithms: ["RS256"],
        clockTolerance: 60,
      }));
    } catch {
      // Covers bad signature, wrong issuer (tenant), wrong audience, expired,
      // not-yet-valid, and malformed tokens.
      throw unauthorized();
    }

    // `iss` already pins the tenant, but Entra also stamps `tid`. Checking both
    // means a token cannot pass on issuer alone if the two ever disagree.
    if (payload.tid !== this.tenantId) throw unauthorized();

    // `oid` is the immutable per-tenant user object ID. `sub` is pairwise per
    // application and would change if the API registration were recreated, so it
    // is not usable as the durable link to the Data Kitchen user record.
    const externalId = firstString(payload, "oid");
    if (!externalId) throw unauthorized();

    const email = firstString(payload, "preferred_username", "email", "upn") ?? "";
    const displayName = firstString(payload, "name") ?? email;

    return { externalId, email, displayName, rawClaims: payload as Record<string, unknown> };
  }
}
