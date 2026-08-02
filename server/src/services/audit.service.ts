import type { PrismaClient } from "@prisma/client";

export interface AuditEntry {
  organizationId?: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  result: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(
  prisma: PrismaClient,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        requestId: entry.requestId ?? null,
        result: entry.result,
        metadata: (entry.metadata ?? {}) as any,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
      },
    });
  } catch {
    // Audit failures must not break request processing
  }
}
