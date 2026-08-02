import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";
import { catalogRoutes } from "../../src/routes/catalog.routes.js";
import { productRoutes } from "../../src/routes/product.routes.js";
import { organizationRoutes } from "../../src/routes/organization.routes.js";
import { userRoutes } from "../../src/routes/user.routes.js";
import { healthRoutes } from "../../src/routes/health.routes.js";
import { registerAuthHook } from "../../src/auth/middleware.js";
import { AutoTenantResolver } from "../../src/auth/auto-tenant-resolver.js";
import { writeAuditLog } from "../../src/services/audit.service.js";
import { AppError } from "../../src/errors/api-errors.js";
import type { AuthProvider, AuthenticatedUser } from "../../src/auth/types.js";

// ---------------------------------------------------------------------------
// Test fixtures — 2 orgs, 2 users, 3 memberships
// ---------------------------------------------------------------------------
const ORG_ALPHA = "10000000-0000-0000-0000-000000000001";
const ORG_BETA = "10000000-0000-0000-0000-000000000002";
const USER_ALICE = "20000000-0000-0000-0000-000000000001";
const USER_BOB = "20000000-0000-0000-0000-000000000002";
const MBR_ALICE_ALPHA = "30000000-0000-0000-0000-000000000001";
const MBR_ALICE_BETA = "30000000-0000-0000-0000-000000000002";
const MBR_BOB_BETA = "30000000-0000-0000-0000-000000000003";

const TOKEN_ALICE = "integration-test-token-alice";
const TOKEN_BOB = "integration-test-token-bob";

// ---------------------------------------------------------------------------
// Test auth provider — maps tokens to test users
// ---------------------------------------------------------------------------
class TestAuthProvider implements AuthProvider {
  private users = new Map<string, AuthenticatedUser>();
  register(token: string, user: AuthenticatedUser) {
    this.users.set(token, user);
  }
  async validateToken(token: string): Promise<AuthenticatedUser> {
    const user = this.users.get(token);
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Invalid development token");
    return user;
  }
}

// ---------------------------------------------------------------------------
// Cleanup — handles any leftover data from prior failed runs
// ---------------------------------------------------------------------------
async function cleanupTestData(prisma: PrismaClient) {
  const orgIds = [ORG_ALPHA, ORG_BETA];
  const userIds = [USER_ALICE, USER_BOB];
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.catalog.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("Tenant isolation — PostgreSQL integration", () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let alphaCatalogId: string;
  let betaCatalogId: string;

  // Helper — build common auth headers
  function auth(token: string, orgId?: string) {
    const h: Record<string, string> = { authorization: `Bearer ${token}` };
    if (orgId) h["x-organization-id"] = orgId;
    return h;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: DB_URL });
    await prisma.$connect();
    await cleanupTestData(prisma);

    // Seed organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_ALPHA, name: "[TEST] Alpha Corp", slug: "test-alpha", status: "active", settings: {} },
        { id: ORG_BETA, name: "[TEST] Beta Inc", slug: "test-beta", status: "active", settings: {} },
      ],
    });

    // Seed users
    await prisma.user.createMany({
      data: [
        { id: USER_ALICE, externalIdentityId: "test-alice-001", email: "alice@test.local", displayName: "Alice (Test)", status: "active" },
        { id: USER_BOB, externalIdentityId: "test-bob-001", email: "bob@test.local", displayName: "Bob (Test)", status: "active" },
      ],
    });

    // Seed memberships: Alice = admin(Alpha) + viewer(Beta), Bob = operator(Beta)
    await prisma.organizationMembership.createMany({
      data: [
        { id: MBR_ALICE_ALPHA, organizationId: ORG_ALPHA, userId: USER_ALICE, role: "organization_admin", status: "active" },
        { id: MBR_ALICE_BETA, organizationId: ORG_BETA, userId: USER_ALICE, role: "viewer", status: "active" },
        { id: MBR_BOB_BETA, organizationId: ORG_BETA, userId: USER_BOB, role: "operator", status: "active" },
      ],
    });

    // Seed catalogs for cross-tenant and catalog_type tests
    const [alphaC, betaC] = await Promise.all([
      prisma.catalog.create({
        data: { organizationId: ORG_ALPHA, name: "[TEST] Alpha Catalog", catalogType: "test", createdBy: "seed", updatedBy: "seed" },
      }),
      prisma.catalog.create({
        data: { organizationId: ORG_BETA, name: "[TEST] Beta Catalog", catalogType: "test", createdBy: "seed", updatedBy: "seed" },
      }),
    ]);
    alphaCatalogId = alphaC.id;
    betaCatalogId = betaC.id;

    // Production catalog in Beta for catalog_type filter test
    await prisma.catalog.create({
      data: { organizationId: ORG_BETA, name: "[TEST] Beta Prod Catalog", catalogType: "production", createdBy: "seed", updatedBy: "seed" },
    });

    // --- Build test Fastify app ---
    const authProvider = new TestAuthProvider();
    authProvider.register(TOKEN_ALICE, { externalId: "test-alice-001", email: "alice@test.local", displayName: "Alice (Test)", rawClaims: {} });
    authProvider.register(TOKEN_BOB, { externalId: "test-bob-001", email: "bob@test.local", displayName: "Bob (Test)", rawClaims: {} });

    app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
    await app.register(cors, { origin: ["http://localhost:5173"] });
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

    app.decorate("prisma", prisma);
    app.decorate("storage", {
      upload: async () => {},
      download: async () => Buffer.from(""),
      exists: async () => false,
      getUrl: async (k: string) => `stub://${k}`,
    } as any);
    app.decorate("config", { nodeEnv: "test", upload: { maxFileSizeMb: 50 } } as any);

    registerAuthHook(app, authProvider, new AutoTenantResolver());

    // Error handler mirrors index.ts
    app.setErrorHandler(async (error, request, reply) => {
      if (error instanceof AppError) {
        if (error.code === "FORBIDDEN" && error.details?.requiredPermission) {
          await writeAuditLog(prisma, {
            organizationId: request.tenantContext?.organizationId,
            userId: request.tenantContext?.userId,
            action: "authorization.denied",
            requestId: request.requestId,
            result: "denied",
            metadata: {
              permission: error.details.requiredPermission,
              route: request.url.split("?")[0],
              method: request.method,
            },
          });
        }
        return reply.status(error.statusCode).send({
          error: { code: error.code, message: error.message, details: error.details },
        });
      }
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Unexpected error" },
      });
    });

    await app.register(healthRoutes, { prefix: "/api/v1" });
    await app.register(userRoutes, { prefix: "/api/v1" });
    await app.register(catalogRoutes, { prefix: "/api/v1" });
    await app.register(productRoutes, { prefix: "/api/v1" });
    await app.register(organizationRoutes, { prefix: "/api/v1" });

    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) {
      await cleanupTestData(prisma);
      await prisma.$disconnect();
    }
  }, 15_000);

  // ===========================
  // Authentication (tests 13-15)
  // ===========================

  it("rejects an incorrect token with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogs" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("health endpoint requires no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  // ===========================
  // User identity (tests 16-17)
  // ===========================

  it("GET /me returns user info without tenant resolution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: auth(TOKEN_ALICE),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.email).toBe("alice@test.local");
    expect(data.displayName).toBe("Alice (Test)");
    expect(data.organizationCount).toBe(2);
  });

  it("GET /me/organizations returns memberships", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/organizations",
      headers: auth(TOKEN_ALICE),
    });
    expect(res.statusCode).toBe(200);
    const orgs = res.json().data;
    expect(orgs).toHaveLength(2);
    const alpha = orgs.find((o: any) => o.id === ORG_ALPHA);
    const beta = orgs.find((o: any) => o.id === ORG_BETA);
    expect(alpha.role).toBe("organization_admin");
    expect(beta.role).toBe("viewer");
  });

  // ===========================
  // Organization selection (tests 18-20)
  // ===========================

  it("multi-org user gets ORGANIZATION_REQUIRED without header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: auth(TOKEN_ALICE),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("ORGANIZATION_REQUIRED");
    expect(res.json().error.details.organizations).toHaveLength(2);
  });

  it("multi-org user selects org via X-Organization-Id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: auth(TOKEN_ALICE, ORG_ALPHA),
    });
    expect(res.statusCode).toBe(200);
    const catalogs = res.json().data;
    expect(catalogs.every((c: any) => c.organizationId === ORG_ALPHA)).toBe(true);
  });

  it("invalid X-Organization-Id returns INVALID_ORGANIZATION", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: auth(TOKEN_ALICE, "99999999-0000-0000-0000-000000000099"),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("INVALID_ORGANIZATION");
  });

  // ===========================
  // Cross-tenant isolation (tests 1-4)
  // ===========================

  it("Alice in Alpha cannot see Beta's catalogs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: auth(TOKEN_ALICE, ORG_ALPHA),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((c: any) => c.id);
    expect(ids).toContain(alphaCatalogId);
    expect(ids).not.toContain(betaCatalogId);
  });

  it("Bob in Beta cannot access Alpha's catalog by ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalogs/${alphaCatalogId}`,
      headers: auth(TOKEN_BOB),
    });
    expect(res.statusCode).toBe(404);
  });

  it("catalog created by Alice in Alpha is scoped to Alpha", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_ALICE, ORG_ALPHA), "content-type": "application/json" },
      payload: { name: "[TEST] Alice Alpha Scoped" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.organizationId).toBe(ORG_ALPHA);
  });

  it("product listing for Bob is scoped to Beta", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalogs/${betaCatalogId}/products`,
      headers: auth(TOKEN_BOB),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  // ===========================
  // Role-based access control (tests 5-8)
  // ===========================

  it("viewer cannot create catalogs (catalog:write denied)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_ALICE, ORG_BETA), "content-type": "application/json" },
      payload: { name: "Should Fail" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("viewer cannot manage org settings (organization:manage denied)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/organization",
      headers: { ...auth(TOKEN_ALICE, ORG_BETA), "content-type": "application/json" },
      payload: { name: "Should Fail" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("operator can create catalogs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_BOB), "content-type": "application/json" },
      payload: { name: "[TEST] Bob Operator Catalog" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("admin can manage org settings", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/organization",
      headers: { ...auth(TOKEN_ALICE, ORG_ALPHA), "content-type": "application/json" },
      payload: { name: "[TEST] Alpha Corp Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("[TEST] Alpha Corp Updated");
  });

  // ===========================
  // Audit logging (tests 9-12)
  // ===========================

  it("auth failure produces an audit record", async () => {
    const reqId = "test-audit-auth-fail-001";
    await app.inject({
      method: "GET",
      url: "/api/v1/catalogs",
      headers: { authorization: "Bearer bad-token-xyz", "x-request-id": reqId },
    });
    const log = await prisma.auditLog.findFirst({ where: { requestId: reqId } });
    expect(log).not.toBeNull();
    expect(log!.action).toBe("authentication.failed");
    expect(log!.result).toBe("failure");
  });

  it("catalog creation produces an audit record", async () => {
    const reqId = "test-audit-cat-create-001";
    await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_ALICE, ORG_ALPHA), "content-type": "application/json", "x-request-id": reqId },
      payload: { name: "[TEST] Audit Check Catalog" },
    });
    const log = await prisma.auditLog.findFirst({ where: { requestId: reqId, action: "catalog.created" } });
    expect(log).not.toBeNull();
    expect(log!.organizationId).toBe(ORG_ALPHA);
    expect(log!.result).toBe("success");
  });

  it("org settings update produces an audit record", async () => {
    const reqId = "test-audit-org-update-001";
    await app.inject({
      method: "PATCH",
      url: "/api/v1/organization",
      headers: { ...auth(TOKEN_ALICE, ORG_ALPHA), "content-type": "application/json", "x-request-id": reqId },
      payload: { settings: { auditCheck: true } },
    });
    const log = await prisma.auditLog.findFirst({ where: { requestId: reqId, action: "organization.settings_updated" } });
    expect(log).not.toBeNull();
    expect(log!.result).toBe("success");
  });

  it("authorization denial produces an audit record", async () => {
    const reqId = "test-audit-authz-denied-001";
    await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_ALICE, ORG_BETA), "content-type": "application/json", "x-request-id": reqId },
      payload: { name: "Denied" },
    });
    const log = await prisma.auditLog.findFirst({ where: { requestId: reqId, action: "authorization.denied" } });
    expect(log).not.toBeNull();
    expect(log!.result).toBe("denied");
    expect((log!.metadata as any).permission).toBe("catalog:write");
  });

  // ===========================
  // Catalog classification (tests 21-22)
  // ===========================

  it("catalog created without catalog_type defaults to 'test'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalogs",
      headers: { ...auth(TOKEN_ALICE, ORG_ALPHA), "content-type": "application/json" },
      payload: { name: "[TEST] Default Type" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.catalogType).toBe("test");
  });

  it("catalog_type filter returns only matching catalogs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalogs?catalog_type=production",
      headers: auth(TOKEN_BOB),
    });
    expect(res.statusCode).toBe(200);
    const catalogs = res.json().data;
    expect(catalogs.length).toBeGreaterThanOrEqual(1);
    expect(catalogs.every((c: any) => c.catalogType === "production")).toBe(true);
  });

  // ===========================
  // Request context (test 23)
  // ===========================

  it("X-Request-Id is propagated in response header", async () => {
    const customId = "my-custom-correlation-id-789";
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": customId },
    });
    expect(res.headers["x-request-id"]).toBe(customId);
  });
});
