import type { FastifyInstance } from "fastify";
import "../types.js";

export async function productRoutes(app: FastifyInstance) {
  app.get<{
    Params: { catalogId: string };
    Querystring: { page?: string; limit?: string; status?: string; search?: string };
  }>("/catalogs/:catalogId/products", async (request, reply) => {
    const { catalogId } = request.params;
    const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { catalogId };

    if (request.query.status && request.query.status !== "all") {
      where.dataQualityStatus = request.query.status;
    }

    if (request.query.search) {
      const search = request.query.search;
      where.OR = [
        { productName: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { gtin: { contains: search, mode: "insensitive" } },
      ];
    }

    const [products, total] = await Promise.all([
      app.prisma.canonicalProduct.findMany({
        where: where as any,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      app.prisma.canonicalProduct.count({ where: where as any }),
    ]);

    return reply.send({
      data: products,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (request, reply) => {
    const product = await app.prisma.canonicalProduct.findUnique({
      where: { id: request.params.id },
    });

    if (!product) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Product not found: ${request.params.id}` },
      });
    }

    return reply.send({ data: product });
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/products/:id/source-records",
    async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "20", 10)));
      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        app.prisma.sourceRecord.findMany({
          where: { canonicalProductId: request.params.id },
          orderBy: { createdAt: "desc" },
          include: {
            importBatch: {
              select: { filename: true, sourceSystem: true, uploadedAt: true },
            },
          },
          skip,
          take: limit,
        }),
        app.prisma.sourceRecord.count({
          where: { canonicalProductId: request.params.id },
        }),
      ]);

      return reply.send({
        data: records,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/products/:id/provenance",
    async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "50", 10)));
      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        app.prisma.fieldProvenance.findMany({
          where: { canonicalProductId: request.params.id },
          orderBy: { createdAt: "desc" },
          include: {
            sourceRecord: {
              select: {
                importBatch: { select: { filename: true, sourceSystem: true } },
              },
            },
          },
          skip,
          take: limit,
        }),
        app.prisma.fieldProvenance.count({
          where: { canonicalProductId: request.params.id },
        }),
      ]);

      return reply.send({
        data: records,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/products/:id/history",
    async (request, reply) => {
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "50", 10)));
      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        app.prisma.canonicalProductHistory.findMany({
          where: { canonicalProductId: request.params.id },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        app.prisma.canonicalProductHistory.count({
          where: { canonicalProductId: request.params.id },
        }),
      ]);

      return reply.send({
        data: records,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  );
}
