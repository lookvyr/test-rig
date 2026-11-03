// @effect-diagnostics globalDate:off -- Tests exercise local calendar snooze boundaries.
import { describe, expect, it } from "vite-plus/test";

import {
  canSnooze,
  effectiveSnoozed,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadRaisedHandWhileSnoozed,
  threadWokeAt,
  type ThreadSnoozeShell,
} from "./threadSettled.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const SNOOZED_AT = "2026-04-10T09:00:00.000Z";
const FUTURE_WAKE = "2026-04-11T09:00:00.000Z";
const PAST_WAKE = "2026-04-10T10:00:00.000Z";

function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function makeShell(input: {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly sessionStatus?: "starting" | "running" | "ready" | "error";
  readonly pending?: "approval" | "user-input";
  readonly turnCompletedAt?: string | null;
}): ThreadSnoozeShell {
  return {
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt: input.snoozedAt ?? (input.snoozedUntil != null ? SNOOZED_AT : null),
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    runtime:
      input.sessionStatus === undefined
        ? null
        : {
            status:
              input.sessionStatus === "error"
                ? "failed"
                : input.sessionStatus === "ready"
                  ? "idle"
                  : input.sessionStatus,
            providerName: "Codex",
            lastError: input.sessionStatus === "error" ? "boom" : null,
            updatedAt: "2026-04-10T11:00:00.000Z",
          },
    latestRun:
      input.turnCompletedAt === undefined && input.sessionStatus !== "error"
        ? null
        : {
            status: input.sessionStatus === "error" ? "failed" : "completed",
            requestedAt: SNOOZED_AT,
            startedAt: null,
            completedAt: input.turnCompletedAt ?? "2026-04-10T11:00:00.000Z",
            assistantMessageId: null,
          },
  };
}

describe("effectiveSnoozed", () => {
  it("hides a thread whose wake time is in the future", () => {
    expect(effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE }), { now: NOW })).toBe(true);
  });

  it("stops classifying as snoozed once the wake time passes (timer wake, no event)", () => {
    expect(effectiveSnoozed(makeShell({ snoozedUntil: PAST_WAKE }), { now: NOW })).toBe(false);
  });

  it("never snoozes a thread with no snooze state", () => {
    expect(effectiveSnoozed(makeShell({}), { now: NOW })).toBe(false);
  });

  it("never hides on malformed wake data", () => {
    expect(effectiveSnoozed(makeShell({ snoozedUntil: "not-a-date" }), { now: NOW })).toBe(false);
  });

  it("wakes early when the agent is blocked on the user", () => {
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" }), {
        now: NOW,
      }),
    ).toBe(false);
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it("wakes early on a failure that happened after the snooze", () => {
    // The failed run completed at 11:00, after SNOOZED_AT (9:00).
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  it("stays snoozed when the failure predates the snooze — the user saw it", () => {
    expect(
      effectiveSnoozed(
        makeShell({
          snoozedUntil: FUTURE_WAKE,
          sessionStatus: "error",
          // Snoozed AFTER the error's status edge.
          snoozedAt: "2026-04-10T11:30:00.000Z",
        }),
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("stays snoozed while the session keeps working — snooze never pauses the agent", () => {
    expect(
      effectiveSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "running" }), {
        now: NOW,
      }),
    ).toBe(true);
  });

  it("wakes early when a run completes after the snooze was set", () => {
    expect(
      effectiveSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, turnCompletedAt: "2026-04-10T10:30:00.000Z" }),
        { now: NOW },
      ),
    ).toBe(false);
  });

  it("ignores runs that completed before the snooze — the user saw that result", () => {
    expect(
      effectiveSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, turnCompletedAt: "2026-04-10T08:00:00.000Z" }),
        { now: NOW },
      ),
    ).toBe(true);
  });
});

describe("threadRaisedHandWhileSnoozed", () => {
  it("is false for a quiet snoozed thread", () => {
    expect(threadRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE }))).toBe(false);
  });

  it("is true for approvals, input, and failures", () => {
    expect(
      threadRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "approval" })),
    ).toBe(true);
    expect(
      threadRaisedHandWhileSnoozed(makeShell({ snoozedUntil: FUTURE_WAKE, pending: "user-input" })),
    ).toBe(true);
    expect(
      threadRaisedHandWhileSnoozed(
        makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }),
      ),
    ).toBe(true);
  });
});

describe("canSnooze", () => {
  it("allows snoozing quiet and working threads alike", () => {
    expect(canSnooze({ ...makeShell({}), latestUserMessageAt: null }, { now: NOW })).toBe(true);
    expect(
      canSnooze(
        { ...makeShell({ sessionStatus: "running" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(true);
  });

  it("refuses blocked-on-you work", () => {
    expect(
      canSnooze({ ...makeShell({ pending: "approval" }), latestUserMessageAt: null }, { now: NOW }),
    ).toBe(false);
    expect(
      canSnooze(
        { ...makeShell({ pending: "user-input" }), latestUserMessageAt: null },
        { now: NOW },
      ),
    ).toBe(false);
  });

  it.each(["queued", "preparing", "starting"] as const)(
    "defers %s work to the server while still blocking pending user requests",
    (status) => {
      const base = makeShell({ turnCompletedAt: NOW });
      const queued = {
        ...base,
        latestRun: { ...base.latestRun!, status },
        runtime: { status },
        latestUserMessageAt: SNOOZED_AT,
      };
      expect(canSnooze(queued, { now: NOW })).toBe(true);
      expect(canSnooze({ ...queued, hasPendingApprovals: true }, { now: NOW })).toBe(false);
      expect(canSnooze({ ...queued, hasPendingUserInput: true }, { now: NOW })).toBe(false);
    },
  );
});

describe("threadWokeAt", () => {
  it("is null for never-snoozed and still-snoozed threads", () => {
    expect(threadWokeAt(makeShell({}), { now: NOW })).toBe(null);
    expect(threadWokeAt(makeShell({ snoozedUntil: FUTURE_WAKE }), { now: NOW })).toBe(null);
  });

  it.each(["approval", "user-input"] as const)(
    "dates a new %s wake after a visit during the snooze",
    (pending) => {
      const shell = makeShell({ snoozedUntil: FUTURE_WAKE, pending, sessionStatus: "running" });
      const wokeAt = threadWokeAt(shell, { now: NOW });
      expect(wokeAt).toBe("2026-04-10T11:00:00.000Z");
      expect(Date.parse(wokeAt!) > Date.parse("2026-04-10T10:00:00.000Z")).toBe(true);
    },
  );

  it("reports the wake time for a timer wake", () => {
    expect(threadWokeAt(makeShell({ snoozedUntil: PAST_WAKE }), { now: NOW })).toBe(PAST_WAKE);
  });

  it("reports the completion time for an early run-completed wake", () => {
    expect(
      threadWokeAt(
        makeShell({ snoozedUntil: FUTURE_WAKE, turnCompletedAt: "2026-04-10T10:30:00.000Z" }),
        { now: NOW },
      ),
    ).toBe("2026-04-10T10:30:00.000Z");
  });

  it("falls back to session activity for blocked/failed early wakes", () => {
    expect(
      threadWokeAt(makeShell({ snoozedUntil: FUTURE_WAKE, sessionStatus: "error" }), {
        now: NOW,
      }),
    ).toBe("2026-04-10T11:00:00.000Z");
  });

  it("keeps the early wake authoritative after the scheduled time passes", () => {
    // Woke early at 10:30 via run-completed; the scheduled wake (PAST_WAKE
    // 10:00 relative to a later now) has ALSO passed. Reporting the
    // scheduled time would resurface a Woke pill the user already cleared
    // by visiting between the early wake and now.
    expect(
      threadWokeAt(
        makeShell({ snoozedUntil: PAST_WAKE, turnCompletedAt: "2026-04-10T09:30:00.000Z" }),
        { now: NOW },
      ),
    ).toBe("2026-04-10T09:30:00.000Z");
  });
});

describe("snoozeWakeLabel", () => {
  const now = "2026-06-02T00:00:00.000Z";

  it("formats remaining time coarsely, rounding up", () => {
    expect(snoozeWakeLabel("2026-06-02T00:30:00.000Z", { now })).toBe("30m");
    expect(snoozeWakeLabel("2026-06-02T01:30:00.000Z", { now })).toBe("2h");
    expect(snoozeWakeLabel("2026-06-03T02:00:00.000Z", { now })).toBe("2d");
  });

  it("never reads zero or negative while still snoozed", () => {
    expect(snoozeWakeLabel("2026-06-02T00:00:30.000Z", { now })).toBe("1m");
    expect(snoozeWakeLabel("2026-06-01T23:59:59.000Z", { now })).toBe("now");
    expect(snoozeWakeLabel("not-a-date", { now })).toBe("now");
    expect(snoozeWakeLabel("2026-06-02T09:00:00.000Z", { now: "bad" })).toBe("now");
  });
});

describe("resolveSnoozePresets", () => {
  it("offers the default choices", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10));
    expect(presets.map((preset) => [preset.id, preset.label])).toEqual([
      ["after:60", "In 1 hour"],
      ["after:180", "In 3 hours"],
      ["at:today:18:00", "This evening"],
      ["at:tomorrow:09:00", "Tomorrow"],
      ["at:monday:09:00", "Next week"],
    ]);
    expect(
      new Date(
        presets.find((preset) => preset.id === "at:tomorrow:09:00")!.snoozedUntil,
      ).getHours(),
    ).toBe(9);
  });

  it("drops a today choice once its time has passed", () => {
    expect(resolveSnoozePresets(localDate(2026, 4, 8, 18)).map((preset) => preset.id)).toEqual([
      "after:60",
      "after:180",
      "at:tomorrow:09:00",
      "at:monday:09:00",
    ]);
  });

  it("puts next week on the following Monday", () => {
    const nextWeek = new Date(
      resolveSnoozePresets(localDate(2026, 4, 6, 10)).find(
        (preset) => preset.id === "at:monday:09:00",
      )!.snoozedUntil,
    );
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getDate()).toBe(13);
  });

  it("sorts custom options soonest first and collapses ones that wake together", () => {
    // Sunday 2026-04-05 20:00: Monday 09:00 is tomorrow.
    const presets = resolveSnoozePresets(localDate(2026, 4, 5, 20), {
      presets: [
        { kind: "at", day: "monday", time: "09:00" },
        { kind: "at", day: "friday", time: "16:30" },
        { kind: "after", minutes: 90 },
        { kind: "at", day: "tomorrow", time: "09:00" },
        { kind: "after", minutes: 2 * 24 * 60 },
      ],
    });
    expect(presets.map((preset) => [preset.label, preset.whenLabel.length > 0])).toEqual([
      ["In 90 minutes", true],
      ["Tomorrow", true],
      ["In 2 days", true],
      ["Friday", true],
    ]);
    // A duration that wakes on another day names it.
    expect(presets[2]!.whenLabel).toMatch(/^Tue /);
  });
});
