import { AppError } from "../errors/api-errors.js";
import type { TenantContext } from "./types.js";

export type Permission =
  | "catalog:read"
  | "catalog:write"
  | "product:read"
  | "import:execute"
  | "organization:manage";

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  organization_admin: [
    "catalog:read",
    "catalog:write",
    "product:read",
    "import:execute",
    "organization:manage",
  ],
  operator: [
    "catalog:read",
    "catalog:write",
    "product:read",
    "import:execute",
  ],
  viewer: [
    "catalog:read",
    "product:read",
  ],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions !== undefined && permissions.includes(permission);
}

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!hasPermission(ctx.role, permission)) {
    throw new AppError(403, "FORBIDDEN", "Insufficient permissions", {
      requiredPermission: permission,
    });
  }
}
