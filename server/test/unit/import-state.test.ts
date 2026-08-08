import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  cancellationKind,
  timestampsFor,
  InvalidImportTransitionError,
  IMPORT_STATES,
  TERMINAL_STATES,
} from "../../src/jobs/import-state.js";

describe("import state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("uploaded", "queued")).toBe(true);
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
    expect(canTransition("processing", "completed_with_warnings")).toBe(true);
  });

  it("allows lease reclaim: processing back to queued", () => {
    // A worker that died without releasing leaves the row in `processing`;
    // reclaim returns it to the queue rather than failing it outright.
    expect(canTransition("processing", "queued")).toBe(true);
  });

  it("allows bounded retry from failed", () => {
    expect(canTransition("failed", "queued")).toBe(true);
  });

  it("rejects every transition out of a terminal state except retry", () => {
    for (const terminal of TERMINAL_STATES) {
      for (const to of IMPORT_STATES) {
        const allowed = terminal === "failed" && to === "queued";
        expect(canTransition(terminal, to)).toBe(allowed);
      }
    }
  });

  it("rejects skipping the queue", () => {
    expect(canTransition("uploaded", "processing")).toBe(false);
    expect(canTransition("uploaded", "completed")).toBe(false);
  });

  it("rejects unknown source states", () => {
    expect(canTransition("nonsense", "queued")).toBe(false);
  });

  it("only lets legacy statuses move to a terminal state", () => {
    // The backfill marks interrupted pre-1.0.2 imports as failed; nothing else.
    expect(canTransition("parsing", "failed")).toBe(true);
    expect(canTransition("parsing", "cancelled")).toBe(true);
    expect(canTransition("parsing", "queued")).toBe(false);
    expect(canTransition("parsing", "processing")).toBe(false);
    expect(canTransition("pending", "failed")).toBe(true);
  });

  it("throws a 409-shaped error on an illegal transition", () => {
    expect(() => assertTransition("completed", "processing")).toThrow(InvalidImportTransitionError);
    try {
      assertTransition("completed", "processing");
    } catch (e) {
      const err = e as InvalidImportTransitionError;
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("INVALID_IMPORT_TRANSITION");
      expect(err.message).toContain("completed");
      expect(err.message).toContain("processing");
    }
  });

  it("identifies terminal states", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("completed_with_warnings")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("processing")).toBe(false);
  });

  it("stamps the right timestamps per state", () => {
    const now = new Date("2026-08-08T12:00:00Z");
    expect(timestampsFor("queued", now)).toEqual({ queuedAt: now });
    expect(timestampsFor("processing", now)).toEqual({ startedAt: now, heartbeatAt: now });
    for (const t of TERMINAL_STATES) {
      expect(timestampsFor(t, now)).toEqual({ completedAt: now });
    }
  });

  it("classifies cancellation per the approved semantics", () => {
    expect(cancellationKind("queued")).toBe("immediate");
    expect(cancellationKind("uploaded")).toBe("immediate");
    expect(cancellationKind("processing")).toBe("cooperative");
    expect(cancellationKind("completed")).toBe("not-cancellable");
    expect(cancellationKind("failed")).toBe("not-cancellable");
    expect(cancellationKind("cancelled")).toBe("not-cancellable");
  });
});
