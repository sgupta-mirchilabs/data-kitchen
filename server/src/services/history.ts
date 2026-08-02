/**
 * History value serialization convention:
 * - Scalars: string representation ("1.82", "Vietnam", "true")
 * - Null: stored as SQL NULL (not the string "null")
 * - Arrays/objects: JSON.stringify when leaf-level comparison is not practical
 */

export function serializeHistoryValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export interface HistoryChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
}

export function diffProductFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  prefix = "",
): HistoryChange[] {
  const changes: HistoryChange[] = [];

  for (const [key, newVal] of Object.entries(incoming)) {
    if (newVal === null || newVal === undefined) continue;

    const field = prefix ? `${prefix}.${key}` : key;
    const oldVal = existing[key];

    const serializedOld = serializeHistoryValue(oldVal);
    const serializedNew = serializeHistoryValue(newVal);

    if (serializedOld !== serializedNew) {
      changes.push({
        field,
        previousValue: serializedOld,
        newValue: serializedNew,
      });
    }
  }

  return changes;
}
