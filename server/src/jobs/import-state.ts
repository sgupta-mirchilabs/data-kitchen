/**
 * Import job state machine (Phase 1.0.2, Increment A).
 *
 * Status is the only thing an operator can trust after a restart, so every
 * transition goes through one guarded helper rather than scattered `update`
 * calls. An illegal transition is a programming error and throws, rather than
 * silently corrupting a batch's lifecycle.
 */

export const IMPORT_STATES = [
  /** File uploaded and parsed; mapping not yet confirmed. */
  "uploaded",
  /** Confirmed and durably queued. Safe to close the browser from here. */
  "queued",
  /** A worker holds the lease and is committing chunks. */
  "processing",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;

export type ImportState = (typeof IMPORT_STATES)[number];

export const TERMINAL_STATES: readonly ImportState[] = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

/**
 * Legacy statuses written by the pre-1.0.2 synchronous pipeline. Retained so
 * historical rows remain readable; never a valid transition target.
 */
export const LEGACY_STATES = ["pending", "parsing"] as const;

const TRANSITIONS: Record<ImportState, readonly ImportState[]> = {
  uploaded: ["queued", "cancelled", "failed"],
  // Cancelling a queued job is immediate — nothing has been committed.
  queued: ["processing", "cancelled", "failed"],
  // failed -> queued is the bounded retry path; processing -> queued is lease
  // reclaim after a worker died without releasing.
  processing: ["completed", "completed_with_warnings", "failed", "cancelled", "queued"],
  completed: [],
  completed_with_warnings: [],
  failed: ["queued"],
  cancelled: [],
};

export function isImportState(value: string): value is ImportState {
  return (IMPORT_STATES as readonly string[]).includes(value);
}

export function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function canTransition(from: string, to: ImportState): boolean {
  // Legacy rows may only be moved to a terminal state by the backfill.
  if ((LEGACY_STATES as readonly string[]).includes(from)) {
    return to === "failed" || to === "cancelled";
  }
  if (!isImportState(from)) return false;
  return TRANSITIONS[from].includes(to);
}

export class InvalidImportTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = "INVALID_IMPORT_TRANSITION";
  constructor(readonly from: string, readonly to: ImportState) {
    super(`Cannot move import from "${from}" to "${to}".`);
    this.name = "InvalidImportTransitionError";
  }
}

export function assertTransition(from: string, to: ImportState): void {
  if (!canTransition(from, to)) throw new InvalidImportTransitionError(from, to);
}

/** Timestamp columns each state should stamp when entered. */
export function timestampsFor(to: ImportState, now: Date): Record<string, Date | null> {
  switch (to) {
    case "queued":
      return { queuedAt: now };
    case "processing":
      return { startedAt: now, heartbeatAt: now };
    case "completed":
    case "completed_with_warnings":
    case "failed":
    case "cancelled":
      return { completedAt: now };
    default:
      return {};
  }
}

/** States an operator may cancel from, and how the cancellation behaves. */
export function cancellationKind(state: string): "immediate" | "cooperative" | "not-cancellable" {
  if (state === "queued" || state === "uploaded") return "immediate";
  if (state === "processing") return "cooperative";
  return "not-cancellable";
}
