import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { StorageProvider } from "./storage/storage.interface.js";
import type { TenantContext, AuthenticatedUser } from "./auth/types.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    storage: StorageProvider;
    config: AppConfig;
    importService: import("./services/import.service.js").ImportService;
  }

  interface FastifyRequest {
    requestId: string;
    tenantContext: TenantContext;
    authenticatedUser?: AuthenticatedUser;
  }
}
