import { describe, it, expect } from "vitest";
import { hasPermission, requirePermission, type Permission } from "../../src/auth/permissions.js";
import type { TenantContext } from "../../src/auth/types.js";

function makeCtx(role: string): TenantContext {
  return { userId: "u1", organizationId: "o1", role, displayName: "Test" };
}

describe("hasPermission", () => {
  const cases: Array<{ role: string; permission: Permission; expected: boolean }> = [
    { role: "organization_admin", permission: "catalog:read", expected: true },
    { role: "organization_admin", permission: "catalog:write", expected: true },
    { role: "organization_admin", permission: "product:read", expected: true },
    { role: "organization_admin", permission: "import:execute", expected: true },
    { role: "organization_admin", permission: "organization:manage", expected: true },

    { role: "operator", permission: "catalog:read", expected: true },
    { role: "operator", permission: "catalog:write", expected: true },
    { role: "operator", permission: "product:read", expected: true },
    { role: "operator", permission: "import:execute", expected: true },
    { role: "operator", permission: "organization:manage", expected: false },

    { role: "viewer", permission: "catalog:read", expected: true },
    { role: "viewer", permission: "catalog:write", expected: false },
    { role: "viewer", permission: "product:read", expected: true },
    { role: "viewer", permission: "import:execute", expected: false },
    { role: "viewer", permission: "organization:manage", expected: false },

    { role: "unknown_role", permission: "catalog:read", expected: false },
    { role: "", permission: "catalog:read", expected: false },
  ];

  for (const { role, permission, expected } of cases) {
    it(`${role} ${expected ? "has" : "lacks"} ${permission}`, () => {
      expect(hasPermission(role, permission)).toBe(expected);
    });
  }

  it("does not compare roles as strings or ordinals", () => {
    expect(hasPermission("viewer", "organization:manage")).toBe(false);
    expect(hasPermission("operator", "organization:manage")).toBe(false);
    expect(hasPermission("aaa_super_admin", "catalog:read")).toBe(false);
    expect(hasPermission("zzz_lowest_role", "catalog:read")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("does not throw for allowed permission", () => {
    expect(() => requirePermission(makeCtx("operator"), "catalog:read")).not.toThrow();
  });

  it("throws 403 for denied permission", () => {
    expect(() => requirePermission(makeCtx("viewer"), "import:execute")).toThrow();

    try {
      requirePermission(makeCtx("viewer"), "import:execute");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });
});
