import type { FastifyInstance } from "fastify";
import "../types.js";
import { AutoTenantResolver } from "../auth/auto-tenant-resolver.js";

export async function userRoutes(app: FastifyInstance) {
  const resolver = new AutoTenantResolver();

  app.get("/me", async (request, reply) => {
    const user = request.authenticatedUser;
    if (!user) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    const resolved = await resolver.resolveUser(user, app.prisma);

    return reply.send({
      data: {
        userId: resolved.userId,
        email: resolved.email,
        displayName: resolved.displayName,
        organizationCount: resolved.memberships.length,
      },
    });
  });

  app.get("/me/organizations", async (request, reply) => {
    const user = request.authenticatedUser;
    if (!user) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    const resolved = await resolver.resolveUser(user, app.prisma);

    return reply.send({
      data: resolved.memberships.map((m) => ({
        id: m.organizationId,
        name: m.organizationName,
        slug: m.organizationSlug,
        role: m.role,
      })),
    });
  });
}
