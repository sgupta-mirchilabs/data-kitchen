import type { FastifyInstance } from "fastify";
import "../types.js";
import { requirePermission } from "../auth/permissions.js";
import { writeAuditLog } from "../services/audit.service.js";

const VALID_CATALOG_TYPES = new Set(["test", "production", "sandbox", "other"]);

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/catalogs", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:read");

    const query = request.query as { catalog_type?: string };
    const where: Record<string, unknown> = { organizationId: ctx.organizationId };
    if (query.catalog_type && VALID_CATALOG_TYPES.has(query.catalog_type)) {
      where.catalogType = query.catalog_type;
    }

    let catalogs = await app.prisma.catalog.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
    });

    if (catalogs.length === 0 && !query.catalog_type) {
      const defaultCatalog = await app.prisma.catalog.create({
        data: {
          organizationId: ctx.organizationId,
          name: "Default Catalog",
          description: "Auto-created default catalog",
          catalogType: "test",
          createdBy: ctx.displayName,
          updatedBy: ctx.displayName,
        },
      });
      catalogs = [defaultCatalog];

      await writeAuditLog(app.prisma, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: "catalog.created",
        resourceType: "catalog",
        resourceId: defaultCatalog.id,
        requestId: request.requestId,
        result: "success",
        metadata: { name: "Default Catalog", catalogType: "test", autoCreated: true },
      });
    }

    return reply.send({ data: catalogs });
  });

  app.post("/catalogs", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:write");

    const { name, description, catalog_type } = request.body as {
      name: string;
      description?: string;
      catalog_type?: string;
    };

    const catalogType = (catalog_type && VALID_CATALOG_TYPES.has(catalog_type))
      ? catalog_type
      : "test";

    const catalog = await app.prisma.catalog.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        description,
        catalogType,
        createdBy: ctx.displayName,
        updatedBy: ctx.displayName,
      },
    });

    await writeAuditLog(app.prisma, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: "catalog.created",
      resourceType: "catalog",
      resourceId: catalog.id,
      requestId: request.requestId,
      result: "success",
      metadata: { name, catalogType },
    });

    return reply.status(201).send({ data: catalog });
  });

  app.get<{ Params: { id: string } }>("/catalogs/:id", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:read");

    const catalog = await app.prisma.catalog.findFirst({
      where: { id: request.params.id, organizationId: ctx.organizationId },
    });

    if (!catalog) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Catalog not found: ${request.params.id}` },
      });
    }

    const [productCounts, lastImport, sourceSystems] = await Promise.all([
      app.prisma.canonicalProduct.groupBy({
        by: ["dataQualityStatus"],
        where: { catalogId: catalog.id, organizationId: ctx.organizationId },
        _count: true,
      }),
      app.prisma.importBatch.findFirst({
        where: { catalogId: catalog.id, organizationId: ctx.organizationId, status: "completed" },
        orderBy: { uploadedAt: "desc" },
        select: { id: true, filename: true, uploadedAt: true },
      }),
      app.prisma.importBatch.findMany({
        where: { catalogId: catalog.id, organizationId: ctx.organizationId },
        distinct: ["sourceSystem"],
        select: { sourceSystem: true },
      }),
    ]);

    const totalProducts = productCounts.reduce((sum, g) => sum + g._count, 0);

    const [skuCount, gtinCount, missingCoreCount] = await Promise.all([
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, organizationId: ctx.organizationId, sku: { not: null } } }),
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, organizationId: ctx.organizationId, gtin: { not: null } } }),
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, organizationId: ctx.organizationId, dataQualityStatus: "missing_core_fields" } }),
    ]);

    return reply.send({
      data: {
        ...catalog,
        stats: {
          totalProducts,
          productsWithSku: skuCount,
          productsWithGtin: gtinCount,
          missingCoreFields: missingCoreCount,
          lastImport,
          sourceSystems: sourceSystems.map((s) => s.sourceSystem).filter(Boolean),
          byQuality: Object.fromEntries(productCounts.map((g) => [g.dataQualityStatus, g._count])),
        },
      },
    });
  });
}
