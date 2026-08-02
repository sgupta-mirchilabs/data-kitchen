import type { FastifyInstance } from "fastify";
import "../types.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return reply.send({
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected",
      });
    } catch {
      return reply.status(503).send({
        status: "degraded",
        timestamp: new Date().toISOString(),
        database: "disconnected",
      });
    }
  });
}
