import { EnvironmentId, ProviderInstanceId, RunId } from "@t3tools/contracts";
import { presentThreadShell, type EnvironmentThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { describe, expect, it } from "vite-plus/test";

import { canSettle, hasQueuedTurnStart } from "./threadSettled.ts";

const NOW = "2026-04-10T00:00:00.000Z";
const FRESH = "2026-04-09T00:00:00.000Z";
const STALE = "2026-04-06T23:59:59.999Z";

function makeShell(input: {
  readonly settledOverride?: "settled" | "active" | null;
  readonly activityAt: string | null;
  readonly sessionStatus?: "starting" | "running";
  readonly pending?: "approval" | "user-input";
}): EnvironmentThreadShell {
  return {
    ...presentThreadShell(EnvironmentId.make("test-env"), v2ThreadShell),
    latestRun:
      input.activityAt === null
        ? null
        : {
            runId: RunId.make("run-1"),
            status: "completed",
            requestedAt: input.activityAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledOverride === "settled" ? NOW : null,
    runtime:
      input.sessionStatus === undefined
        ? null
        : {
            status: input.sessionStatus,
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerName: "Codex",
            activeRunId: null,
            lastError: null,
            updatedAt: NOW,
          },
    latestUserMessageAt: null,
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
  };
}

describe("hasQueuedTurnStart", () => {
  it.each(["queued", "preparing"] as const)(
    "keeps %s work queued independently of clocks",
    (status) => {
      const base = makeShell({ activityAt: STALE });
      const queued = { ...base, latestRun: { ...base.latestRun!, status } };
      for (const now of ["2026-04-01T00:00:00.000Z", NOW, "2030-01-01T00:00:00.000Z"]) {
        expect(hasQueuedTurnStart(queued, { now })).toBe(true);
      }
    },
  );
  it("does not infer work from an unadopted user message", () => {
    const shell = { ...makeShell({ activityAt: null }), latestUserMessageAt: NOW };
    expect(hasQueuedTurnStart(shell, { now: NOW })).toBe(false);
  });
  it.each(["running", "completed", "failed", "interrupted"] as const)(
    "does not classify %s as queued",
    (status) => {
      const base = makeShell({ activityAt: FRESH });
      expect(
        hasQueuedTurnStart({ ...base, latestRun: { ...base.latestRun!, status } }, { now: NOW }),
      ).toBe(false);
    },
  );
});

describe("canSettle", () => {
  it("blocks active work and pending requests", () => {
    expect(canSettle(makeShell({ activityAt: FRESH }), { now: NOW })).toBe(true);
    expect(
      canSettle(makeShell({ activityAt: FRESH, sessionStatus: "starting" }), { now: NOW }),
    ).toBe(false);
    expect(
      canSettle(makeShell({ activityAt: FRESH, sessionStatus: "running" }), { now: NOW }),
    ).toBe(false);
    expect(canSettle(makeShell({ activityAt: FRESH, pending: "approval" }), { now: NOW })).toBe(
      false,
    );
    expect(canSettle(makeShell({ activityAt: FRESH, pending: "user-input" }), { now: NOW })).toBe(
      false,
    );
  });

  it.each(["queued", "preparing"] as const)(
    "blocks %s work even after an earlier explicit settle",
    (status) => {
      const base = makeShell({ settledOverride: "settled", activityAt: STALE });
      const queued = { ...base, latestRun: { ...base.latestRun!, status } };
      expect(canSettle(queued, { now: NOW })).toBe(false);
    },
  );

  it("blocks pending input even after an explicit settle", () => {
    // Anything canSettle rejects must render as active even when the user
    // settled it earlier.
    const blocked = makeShell({
      settledOverride: "settled",
      activityAt: FRESH,
      pending: "user-input",
    });
    expect(canSettle(blocked, { now: NOW })).toBe(false);
  });
});
