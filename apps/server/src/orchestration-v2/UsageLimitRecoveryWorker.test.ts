import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import type { ProjectionLimitRecoveryCandidate } from "./ProjectionStore.ts";
import { limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

const stoppedAt = "2026-10-06T12:00:00.000Z";
const resetAt = "2026-10-06T13:00:00.000Z";
const now = Date.parse("2026-10-06T12:30:00.000Z");
const candidate: ProjectionLimitRecoveryCandidate = {
  id: ThreadId.make("limited-thread"),
  status: "failed",
  lastErrorClass: "usage_limit",
  latestRunId: RunId.make("limited-run"),
  usageLimitResetAt: resetAt,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  latestRunCompletedAt: DateTime.makeUnsafe(stoppedAt),
  updatedAt: DateTime.makeUnsafe(stoppedAt),
  limitRecovery: null,
  snoozedUntil: null,
};

describe("usage-limit recovery scheduling", () => {
  it("does nothing without either opt-in", () => {
    expect(limitRecoveryCommand(candidate, false, now, false)).toBeNull();
  });

  it.each([null, "invalid", stoppedAt, "2026-10-06T11:00:00.000Z"])(
    "does not arm or loop with an untrustworthy reset: %s",
    (usageLimitResetAt) => {
      expect(limitRecoveryCommand({ ...candidate, usageLimitResetAt }, true, now, true)).toBeNull();
    },
  );

  it.each([
    { autoResume: true, snooze: false },
    { autoResume: false, snooze: true },
    { autoResume: true, snooze: true },
  ])("arms independent choices: %j", ({ autoResume, snooze }) => {
    expect(limitRecoveryCommand(candidate, autoResume, now, snooze)).toMatchObject({
      type: "thread.metadata.update",
      limitRecovery: { runId: candidate.latestRunId, resetAt, autoResume, snooze },
    });
  });

  it("keeps an explicit cancellation instead of reapplying defaults", () => {
    expect(
      limitRecoveryCommand(
        {
          ...candidate,
          limitRecovery: {
            runId: candidate.latestRunId!,
            resetAt,
            autoResume: false,
            snooze: false,
          },
        },
        true,
        Date.parse(resetAt),
        true,
      ),
    ).toBeNull();
  });

  it("reconstructs the same due delivery after restart, independent of current defaults", () => {
    const persisted = {
      ...candidate,
      limitRecovery: {
        runId: candidate.latestRunId!,
        resetAt,
        autoResume: true,
        snooze: false,
        requestId: CommandId.make("explicit-choice"),
      },
    };
    expect(limitRecoveryCommand(persisted, false, now)).toBeNull();
    const due = limitRecoveryCommand(persisted, false, Date.parse(resetAt));
    expect(due).toMatchObject({
      type: "message.dispatch",
      usageLimitRecoveryRequestId: "explicit-choice",
    });
    expect(limitRecoveryCommand({ ...persisted }, false, Date.parse(resetAt) + 60_000)).toEqual(
      due,
    );
  });

  it("never starts work for a snooze-only choice", () => {
    expect(
      limitRecoveryCommand(
        {
          ...candidate,
          limitRecovery: {
            runId: candidate.latestRunId!,
            resetAt,
            autoResume: false,
            snooze: true,
          },
        },
        false,
        Date.parse(resetAt),
        true,
      ),
    ).toBeNull();
  });
});
