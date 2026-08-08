import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthProvider, TenantResolver } from "./types.js";
import { writeAuditLog } from "../services/audit.service.js";

const PUBLIC_ROUTES = new Set(["/api/v1/health"]);
const AUTH_ONLY_ROUTES = new Set(["/api/v1/me", "/api/v1/me/organizations"]);

function getClientIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return request.ip;
}

export function registerAuthHook(
  app: FastifyInstance,
  authProvider: AuthProvider,
  tenantResolver: TenantResolver,
): void {
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const reqId = (request.headers["x-request-id"] as string) || randomUUID();
      request.requestId = reqId;
      reply.header("X-Request-Id", reqId);

      const routePath = request.url.split("?")[0];

      if (PUBLIC_ROUTES.has(routePath)) {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader) {
        await writeAuditLog(app.prisma, {
          action: "authentication.failed",
          result: "failure",
          requestId: reqId,
          metadata: { reason: "missing_token" },
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"] as string,
        });
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      }

      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;

      // Authentication is handled separately from tenant resolution.
      //
      // Both used to share one catch, which rethrew any error carrying a 4xx
      // statusCode so tenant errors (403 FORBIDDEN, INVALID_ORGANIZATION) could
      // reach the error handler intact. But an invalid token also raises
      // AppError(401), so it took that same rethrow and never reached the audit
      // write below — invalid-credential attempts were answered with 401 and
      // left no audit trail at all, while benign missing-token probes were
      // recorded. Splitting the two keeps tenant errors propagating while
      // making authentication failures auditable.
      let authenticatedUser;
      try {
        authenticatedUser = await authProvider.validateToken(token);
      } catch {
        await writeAuditLog(app.prisma, {
          action: "authentication.failed",
          result: "failure",
          requestId: reqId,
          // Never record the token or any part of it.
          metadata: { reason: "invalid_token" },
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"] as string,
        });
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
        });
      }

      request.authenticatedUser = authenticatedUser;

      if (AUTH_ONLY_ROUTES.has(routePath)) {
        return;
      }

      try {
        const selectedOrgId = request.headers["x-organization-id"] as string | undefined;
        const tenantContext = await tenantResolver.resolve(
          authenticatedUser,
          app.prisma,
          selectedOrgId,
        );
        request.tenantContext = tenantContext;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        const code = (err as { code?: string }).code;

        if (code === "INVALID_ORGANIZATION") {
          await writeAuditLog(app.prisma, {
            action: "organization.selection_failed",
            result: "failure",
            requestId: reqId,
            metadata: { selectedOrgId: request.headers["x-organization-id"] },
            ipAddress: getClientIp(request),
            userAgent: request.headers["user-agent"] as string,
          });
        }

        if (statusCode && statusCode >= 400 && statusCode < 500) {
          throw err;
        }

        await writeAuditLog(app.prisma, {
          action: "authentication.failed",
          result: "failure",
          requestId: reqId,
          metadata: { reason: "invalid_token" },
          ipAddress: getClientIp(request),
          userAgent: request.headers["user-agent"] as string,
        });
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
        });
      }
    },
  );

  app.addHook(
    "onResponse",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const routePath = request.url.split("?")[0];
      if (PUBLIC_ROUTES.has(routePath)) return;

      request.log.info({
        requestId: request.requestId,
        method: request.method,
        route: routePath,
        statusCode: reply.statusCode,
        organizationId: request.tenantContext?.organizationId,
        userId: request.tenantContext?.userId,
        durationMs: reply.elapsedTime,
      }, "request completed");
    },
  );
}
