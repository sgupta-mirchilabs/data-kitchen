import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadConfig } from "./config.js";
import { AppError } from "./errors/api-errors.js";
import { healthRoutes } from "./routes/health.routes.js";
import { catalogRoutes } from "./routes/catalog.routes.js";
import { importRoutes } from "./routes/import.routes.js";
import { productRoutes } from "./routes/product.routes.js";
import { PrismaClient } from "@prisma/client";
import { createStorageProvider } from "./storage/storage.factory.js";

const config = loadConfig();

const prisma = new PrismaClient({
  datasourceUrl: config.databaseUrl,
});

const storage = createStorageProvider(config.storage);

const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
});

await app.register(cors, { origin: config.cors.origin });
await app.register(multipart, {
  limits: { fileSize: config.upload.maxFileSizeMb * 1024 * 1024 },
});

app.decorate("prisma", prisma);
app.decorate("storage", storage);
app.decorate("config", config);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode === 413) {
    return reply.status(413).send({
      error: {
        code: "FILE_TOO_LARGE",
        message: `File exceeds maximum size of ${config.upload.maxFileSizeMb} MB`,
      },
    });
  }

  app.log.error(error);
  const errMessage = error instanceof Error ? error.message : "An unexpected error occurred";
  return reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: config.nodeEnv === "production"
        ? "An unexpected error occurred"
        : errMessage,
    },
  });
});

await app.register(healthRoutes, { prefix: "/api/v1" });
await app.register(catalogRoutes, { prefix: "/api/v1" });
await app.register(importRoutes, { prefix: "/api/v1" });
await app.register(productRoutes, { prefix: "/api/v1" });

try {
  await prisma.$connect();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server listening on ${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

async function shutdown() {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
