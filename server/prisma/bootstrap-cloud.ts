/**
 * One-time bootstrap for the internal cloud development environment.
 *
 * Creates the organizations, users, and memberships needed to exercise the
 * Entra-authenticated multi-tenant paths. Separate from prisma/seed.ts, which is
 * deliberately guarded against non-local databases and hardcodes a development
 * identity that has no meaning under Entra.
 *
 * Every identity here is linked by the user's real Entra object ID (`oid`). No
 * passwords, tokens, or secrets are stored.
 *
 * Usage (requires ALLOW_CLOUD_BOOTSTRAP=true and a DATABASE_URL):
 *   ALLOW_CLOUD_BOOTSTRAP=true PRIMARY_USER_OID=<oid> PRIMARY_USER_EMAIL=<upn> \
 *   PRIMARY_USER_NAME="<display name>" npx tsx prisma/bootstrap-cloud.ts
 *
 * Idempotent: re-running upserts rather than duplicating.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_PRIMARY = "11111111-1111-4111-8111-111111111111";
const ORG_SECOND = "22222222-2222-4222-8222-222222222222";

async function main() {
  if (process.env.ALLOW_CLOUD_BOOTSTRAP !== "true") {
    throw new Error("Refusing to run: set ALLOW_CLOUD_BOOTSTRAP=true to confirm.");
  }

  const oid = process.env.PRIMARY_USER_OID;
  const email = process.env.PRIMARY_USER_EMAIL;
  const displayName = process.env.PRIMARY_USER_NAME ?? email;
  if (!oid || !email) {
    throw new Error("PRIMARY_USER_OID and PRIMARY_USER_EMAIL are required.");
  }

  const orgs = [
    { id: ORG_PRIMARY, name: "Mirchi Labs", slug: "mirchi-labs" },
    { id: ORG_SECOND, name: "Northwind Test Co", slug: "northwind-test" },
  ];
  for (const o of orgs) {
    await prisma.organization.upsert({
      where: { id: o.id },
      update: { name: o.name, slug: o.slug, status: "active" },
      create: { ...o, status: "active" },
    });
  }

  // Primary operator: active, and a member of BOTH organizations so that
  // organization-selection behaviour is exercised (ambiguous without a header).
  const primary = await prisma.user.upsert({
    where: { externalIdentityId: oid },
    update: { email, displayName: displayName!, status: "active" },
    create: { externalIdentityId: oid, email, displayName: displayName!, status: "active" },
  });

  for (const orgId of [ORG_PRIMARY, ORG_SECOND]) {
    const existing = await prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, userId: primary.id },
    });
    if (existing) {
      await prisma.organizationMembership.update({
        where: { id: existing.id },
        data: { role: "organization_admin", status: "active" },
      });
    } else {
      await prisma.organizationMembership.create({
        data: { organizationId: orgId, userId: primary.id, role: "organization_admin", status: "active" },
      });
    }
  }

  // Negative-path fixtures. These identities can never authenticate — the oids
  // are synthetic and no Entra account maps to them — so they are only
  // reachable by the tenant resolver's own checks.
  const inactiveUser = await prisma.user.upsert({
    where: { externalIdentityId: "fixture-inactive-user" },
    update: { status: "inactive" },
    create: {
      externalIdentityId: "fixture-inactive-user",
      email: "inactive.fixture@invalid.local",
      displayName: "Inactive Fixture User",
      status: "inactive",
    },
  });

  const noMembershipUser = await prisma.user.upsert({
    where: { externalIdentityId: "fixture-inactive-membership" },
    update: { status: "active" },
    create: {
      externalIdentityId: "fixture-inactive-membership",
      email: "nomember.fixture@invalid.local",
      displayName: "Inactive Membership Fixture",
      status: "active",
    },
  });

  const existingInactive = await prisma.organizationMembership.findFirst({
    where: { organizationId: ORG_PRIMARY, userId: noMembershipUser.id },
  });
  if (existingInactive) {
    await prisma.organizationMembership.update({
      where: { id: existingInactive.id },
      data: { status: "inactive", role: "member" },
    });
  } else {
    await prisma.organizationMembership.create({
      data: { organizationId: ORG_PRIMARY, userId: noMembershipUser.id, role: "member", status: "inactive" },
    });
  }

  // Catalogs covering both classifications, in both tenants, with an
  // intentionally overlapping name to prove isolation is by organization.
  const catalogs = [
    { orgId: ORG_PRIMARY, name: "Q3 Product Feed", catalogType: "production" },
    { orgId: ORG_PRIMARY, name: "Import Sandbox", catalogType: "test" },
    { orgId: ORG_SECOND, name: "Q3 Product Feed", catalogType: "production" },
    { orgId: ORG_SECOND, name: "Import Sandbox", catalogType: "test" },
  ];
  for (const c of catalogs) {
    const found = await prisma.catalog.findFirst({
      where: { organizationId: c.orgId, name: c.name },
    });
    if (!found) {
      await prisma.catalog.create({
        data: {
          organizationId: c.orgId,
          name: c.name,
          catalogType: c.catalogType,
          description: "Bootstrapped for internal environment validation.",
          createdBy: primary.id,
        },
      });
    }
  }

  console.log("organizations:", await prisma.organization.count());
  console.log("users:", await prisma.user.count());
  console.log("memberships:", await prisma.organizationMembership.count());
  console.log("catalogs:", await prisma.catalog.count());
  console.log("primary user id:", primary.id);
  console.log("inactive fixture id:", inactiveUser.id);
}

main()
  .catch((e) => {
    console.error("bootstrap failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
