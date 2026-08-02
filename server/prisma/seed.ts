import { PrismaClient } from "@prisma/client";

const DEV_ORG_ID = "00000000-0000-0000-0000-000000000001";
const DEV_USER_ID = "00000000-0000-0000-0000-000000000010";
const DEV_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000100";

const APPROVED_HOST_PATTERNS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^host\.docker\.internal$/,
  /\.internal$/,
  /\.local$/,
];

function extractDbHost(url: string): string {
  try {
    const match = url.match(/@([^:/]+)/);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

function extractDbName(url: string): string {
  try {
    const match = url.match(/\/([^?/]+)(\?|$)/);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("REFUSED: Seed script cannot run when NODE_ENV=production.");
    process.exit(1);
  }

  if (process.env.ALLOW_DEV_SEED !== "true") {
    console.error(
      "REFUSED: Set ALLOW_DEV_SEED=true to confirm you want to run the seed script.\n" +
      "This safeguard prevents accidental seeding of non-development databases.",
    );
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbHost = extractDbHost(dbUrl);
  const dbName = extractDbName(dbUrl);

  const hostApproved = APPROVED_HOST_PATTERNS.some((p) => p.test(dbHost));

  if (!hostApproved && process.env.ALLOW_REMOTE_SEED !== "true") {
    console.error(
      `REFUSED: Database host "${dbHost}" is not an approved local/internal host.\n` +
      "Set ALLOW_REMOTE_SEED=true to override this check.",
    );
    process.exit(1);
  }

  console.log(`Seed target: ${dbHost}/${dbName}`);
  console.log("Seeding development data (idempotent upserts, no existing data deleted)...");

  const prisma = new PrismaClient();

  try {
    await prisma.organization.upsert({
      where: { id: DEV_ORG_ID },
      update: {},
      create: {
        id: DEV_ORG_ID,
        name: "[DEV] Development Organization",
        slug: "dev-org",
        status: "active",
        settings: {},
      },
    });

    await prisma.user.upsert({
      where: { id: DEV_USER_ID },
      update: {},
      create: {
        id: DEV_USER_ID,
        externalIdentityId: "dev-user-001",
        email: "dev@datakitchen.local",
        displayName: "[DEV] Development User",
        status: "active",
      },
    });

    await prisma.organizationMembership.upsert({
      where: { id: DEV_MEMBERSHIP_ID },
      update: {},
      create: {
        id: DEV_MEMBERSHIP_ID,
        organizationId: DEV_ORG_ID,
        userId: DEV_USER_ID,
        role: "organization_admin",
        status: "active",
      },
    });

    console.log("Seed complete: [DEV] org, user, and membership created.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
