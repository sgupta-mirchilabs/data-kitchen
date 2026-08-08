import type { PrismaClient } from "@prisma/client";
import {
  computeHeaderFingerprint,
  matchTemplate,
  nextVersion,
  type StoredTemplate,
  type TemplateMatch,
} from "./mapping-template.js";

/**
 * Persistence for saved mapping templates.
 *
 * Every query is scoped by organizationId — templates never cross tenants.
 */

function toStored(row: {
  id: string;
  organizationId: string;
  sourceType: string;
  headerFingerprint: string;
  headers: unknown;
  mappings: unknown;
  version: number;
  name: string | null;
  updatedAt: Date;
}): StoredTemplate {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    headerFingerprint: row.headerFingerprint,
    headers: Array.isArray(row.headers) ? (row.headers as string[]) : [],
    mappings: (row.mappings ?? {}) as Record<string, string>,
    version: row.version,
    name: row.name,
    updatedAt: row.updatedAt,
  };
}

/** Stable, key-order-independent form of a mapping, for equality checks. */
function canonicalize(mappings: unknown): string {
  const entries = Object.entries((mappings ?? {}) as Record<string, string>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return JSON.stringify(entries);
}

export async function findTemplateMatch(
  prisma: PrismaClient,
  organizationId: string,
  headers: string[],
  sourceType: string,
): Promise<TemplateMatch> {
  const rows = await prisma.mappingTemplate.findMany({
    where: { organizationId, sourceType },
    orderBy: { version: "desc" },
    take: 50,
  });
  return matchTemplate(headers, sourceType, rows.map(toStored));
}

export interface SaveTemplateInput {
  organizationId: string;
  sourceType: string;
  headers: string[];
  mappings: Record<string, string>;
  actor?: string;
  /** "new-version" bumps the version; "replace" overwrites the newest match. */
  mode?: "new-version" | "replace";
  name?: string;
}

/**
 * Records the mapping an operator actually confirmed.
 *
 * Called after a successful import so the next upload of the same shape needs no
 * mapping work. A failure here must never fail the import — the caller treats
 * this as best-effort.
 */
export async function saveTemplate(
  prisma: PrismaClient,
  input: SaveTemplateInput,
): Promise<{ id: string; version: number; created: boolean } | null> {
  const mappings = Object.fromEntries(
    Object.entries(input.mappings).filter(([, v]) => typeof v === "string" && v.length > 0),
  );
  if (Object.keys(mappings).length === 0) return null;

  const fingerprint = computeHeaderFingerprint(input.headers);
  const family = await prisma.mappingTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      headerFingerprint: fingerprint,
    },
    orderBy: { version: "desc" },
  });

  const newest = family[0];
  const mode = input.mode ?? "new-version";

  // An identical mapping is not worth a new version — just refresh the row.
  //
  // The comparison must be key-order independent: PostgreSQL JSONB normalizes
  // key order on write (by key length, then bytewise), while the incoming
  // mapping arrives in the order the client sent it. A plain JSON.stringify
  // comparison therefore never matches, and every re-import of an unchanged
  // file would mint another version.
  const unchanged = newest && canonicalize(newest.mappings) === canonicalize(mappings);

  if (newest && (mode === "replace" || unchanged)) {
    const updated = await prisma.mappingTemplate.update({
      where: { id: newest.id },
      data: {
        mappings,
        headers: input.headers,
        updatedBy: input.actor,
        ...(input.name ? { name: input.name } : {}),
      },
    });
    return { id: updated.id, version: updated.version, created: false };
  }

  const created = await prisma.mappingTemplate.create({
    data: {
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      headerFingerprint: fingerprint,
      headers: input.headers,
      mappings,
      version: nextVersion(family.map(toStored)),
      name: input.name ?? null,
      createdBy: input.actor,
      updatedBy: input.actor,
    },
  });
  return { id: created.id, version: created.version, created: true };
}
