export interface AuthenticatedUser {
  externalId: string;
  email: string;
  displayName: string;
  rawClaims: Record<string, unknown>;
}

export interface AuthProvider {
  validateToken(token: string): Promise<AuthenticatedUser>;
}

export interface TenantContext {
  userId: string;
  organizationId: string;
  role: string;
  displayName: string;
}

export interface TenantResolver {
  resolve(
    user: AuthenticatedUser,
    prisma: import("@prisma/client").PrismaClient,
    selectedOrganizationId?: string,
  ): Promise<TenantContext>;
}

export interface UserMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
}

export interface ResolvedUser {
  userId: string;
  email: string;
  displayName: string;
  memberships: UserMembership[];
}
