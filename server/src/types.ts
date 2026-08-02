import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { StorageProvider } from "./storage/storage.interface.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    storage: StorageProvider;
    config: AppConfig;
  }
}
