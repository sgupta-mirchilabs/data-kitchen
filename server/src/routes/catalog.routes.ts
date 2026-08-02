import type { FastifyInstance } from "fastify";
import "../types.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/catalogs", async (request, reply) => {
    const orgId = app.config.defaultOrgId;

    let catalogs = await app.prisma.catalog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });

    if (catalogs.length === 0) {
      const defaultCatalog = await app.prisma.catalog.create({
        data: {
          organizationId: orgId,
          name: "Default Catalog",
          description: "Auto-created default catalog",
          createdBy: app.config.defaultUser,
          updatedBy: app.config.defaultUser,
        },
      });
      catalogs = [defaultCatalog];
    }

    return reply.send({ data: catalogs });
  });

  app.post("/catalogs", async (request, reply) => {
    const { name, description } = request.body as { name: string; description?: string };
    const orgId = app.config.defaultOrgId;

    const catalog = await app.prisma.catalog.create({
      data: {
        organizationId: orgId,
        name,
        description,
        createdBy: app.config.defaultUser,
        updatedBy: app.config.defaultUser,
      },
    });

    return reply.status(201).send({ data: catalog });
  });

  app.get<{ Params: { id: string } }>("/catalogs/:id", async (request, reply) => {
    const catalog = await app.prisma.catalog.findUnique({
      where: { id: request.params.id },
    });

    if (!catalog) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Catalog not found: ${request.params.id}` },
      });
    }

    const [productCounts, lastImport, sourceSystems] = await Promise.all([
      app.prisma.canonicalProduct.groupBy({
        by: ["dataQualityStatus"],
        where: { catalogId: catalog.id },
        _count: true,
      }),
      app.prisma.importBatch.findFirst({
        where: { catalogId: catalog.id, status: "completed" },
        orderBy: { uploadedAt: "desc" },
        select: { id: true, filename: true, uploadedAt: true },
      }),
      app.prisma.importBatch.findMany({
        where: { catalogId: catalog.id },
        distinct: ["sourceSystem"],
        select: { sourceSystem: true },
      }),
    ]);

    const totalProducts = productCounts.reduce((sum, g) => sum + g._count, 0);

    const [skuCount, gtinCount, missingCoreCount] = await Promise.all([
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, sku: { not: null } } }),
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, gtin: { not: null } } }),
      app.prisma.canonicalProduct.count({ where: { catalogId: catalog.id, dataQualityStatus: "missing_core_fields" } }),
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
