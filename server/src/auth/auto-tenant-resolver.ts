import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedUser, TenantContext, TenantResolver, ResolvedUser } from "./types.js";
import { AppError } from "../errors/api-errors.js";

export class AutoTenantResolver implements TenantResolver {
  async resolve(
    user: AuthenticatedUser,
    prisma: PrismaClient,
    selectedOrganizationId?: string,
  ): Promise<TenantContext> {
    const resolved = await this.resolveUser(user, prisma);

    if (resolved.memberships.length === 0) {
      throw new AppError(403, "FORBIDDEN", "No active organization membership");
    }

    if (selectedOrganizationId) {
      const membership = resolved.memberships.find(
        (m) => m.organizationId === selectedOrganizationId,
      );
      if (!membership) {
        throw new AppError(403, "INVALID_ORGANIZATION", "No active membership in the selected organization");
      }
      return {
        userId: resolved.userId,
        organizationId: membership.organizationId,
        role: membership.role,
        displayName: resolved.displayName,
      };
    }

    if (resolved.memberships.length === 1) {
      const membership = resolved.memberships[0];
      return {
        userId: resolved.userId,
        organizationId: membership.organizationId,
        role: membership.role,
        displayName: resolved.displayName,
      };
    }

    throw new AppError(
      400,
      "ORGANIZATION_REQUIRED",
      "Multiple active organization memberships. Send X-Organization-Id header to select one.",
      { organizations: resolved.memberships.map((m) => ({ id: m.organizationId, name: m.organizationName, slug: m.organizationSlug })) },
    );
  }

  async resolveUser(
    user: AuthenticatedUser,
    prisma: PrismaClient,
  ): Promise<ResolvedUser> {
    const dbUser = await prisma.user.findUnique({
      where: { externalIdentityId: user.externalId },
    });

    if (!dbUser || dbUser.status !== "active") {
      throw new AppError(403, "FORBIDDEN", "User account not found or inactive");
    }

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: dbUser.id, status: "active" },
      include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
    });

    const activeMemberships = memberships
      .filter((m) => m.organization.status === "active")
      .map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: m.role,
      }));

    return {
      userId: dbUser.id,
      email: dbUser.email,
      displayName: dbUser.displayName,
      memberships: activeMemberships,
    };
  }
}
