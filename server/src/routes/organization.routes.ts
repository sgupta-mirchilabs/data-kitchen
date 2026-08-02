import type { FastifyInstance } from "fastify";
import "../types.js";
import { requirePermission } from "../auth/permissions.js";
import { writeAuditLog } from "../services/audit.service.js";

export async function organizationRoutes(app: FastifyInstance) {
  app.get("/organization", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:read");

    const org = await app.prisma.organization.findUnique({
      where: { id: ctx.organizationId },
    });

    if (!org) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Organization not found" },
      });
    }

    return reply.send({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        settings: org.settings,
      },
    });
  });

  app.patch("/organization", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "organization:manage");

    const { name, settings } = request.body as { name?: string; settings?: Record<string, unknown> };
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name;
    if (settings !== undefined) updateData.settings = settings;

    const org = await app.prisma.organization.update({
      where: { id: ctx.organizationId },
      data: updateData,
    });

    await writeAuditLog(app.prisma, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: "organization.settings_updated",
      resourceType: "organization",
      resourceId: ctx.organizationId,
      requestId: request.requestId,
      result: "success",
      metadata: { fieldsChanged: Object.keys(updateData) },
    });

    return reply.send({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        settings: org.settings,
      },
    });
  });

  app.get("/organization/members", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "organization:manage");

    const memberships = await app.prisma.organizationMembership.findMany({
      where: { organizationId: ctx.organizationId, status: "active" },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, status: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({
      data: memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        user: m.user,
        createdAt: m.createdAt,
      })),
    });
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>(
    "/organization/audit-log",
    async (request, reply) => {
      const ctx = request.tenantContext;
      requirePermission(ctx, "organization:manage");

      const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "50", 10)));
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        app.prisma.auditLog.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        app.prisma.auditLog.count({ where: { organizationId: ctx.organizationId } }),
      ]);

      return reply.send({
        data: logs,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  );
}
