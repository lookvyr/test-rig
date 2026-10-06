import { RunId } from "@t3tools/contracts";
import { isValidElement, type FunctionComponent } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { usageLimitRecoveryBannerItem } from "./UsageLimitRecoveryBanner";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState, useEffect: () => {} };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

type Props = Parameters<typeof usageLimitRecoveryBannerItem>[0];
const runId = RunId.make("limited-run");
const resetAt = "2026-10-06T13:00:00.000Z";
const onChange = vi.fn<(recovery: Parameters<Props["onChange"]>[0]) => Promise<void>>();
const base: Props = {
  runId,
  resetAt,
  stoppedAt: "2026-10-06T12:00:00.000Z",
  snoozedUntil: null,
  recovery: null,
  onChange,
};
function render(props = base) {
  hooks.beginRender();
  const actions = usageLimitRecoveryBannerItem(props).actions;
  if (!isValidElement<Props>(actions)) throw new Error("Missing recovery controls");
  return (actions.type as FunctionComponent<Props>)(actions.props);
}
function button(label: string, props = base) {
  const found = visitElements(render(props), (element) => element.props.children === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function click(label: string, props = base) {
  (button(label, props).props.onClick as () => void)();
  await Promise.resolve();
}

describe("usage-limit recovery banner", () => {
  beforeEach(() => {
    hooks.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:30:00.000Z"));
    onChange.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it.each([null, "invalid", "2026-10-06T11:00:00.000Z", base.stoppedAt])(
    "offers only manual continuation when reset time is %s",
    (resetAt) => {
      const banner = usageLimitRecoveryBannerItem({ ...base, resetAt });
      expect(banner.actions).toBeNull();
      expect(banner.description).toContain("retry manually");
    },
  );

  it("schedules only after an explicit action and patches resume independently", async () => {
    render();
    expect(onChange).not.toHaveBeenCalled();
    await click("Resume at reset");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ runId, resetAt, autoResume: true });
  });

  it("cancels auto-resume without changing snooze", async () => {
    await click("Cancel auto-resume", {
      ...base,
      recovery: { runId, resetAt, autoResume: true, snooze: true },
      snoozedUntil: resetAt,
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ runId, resetAt, autoResume: false });
  });

  it("wakes a recovery snooze without canceling auto-resume", async () => {
    await click("Wake now", {
      ...base,
      recovery: { runId, resetAt, autoResume: true, snooze: true },
      snoozedUntil: resetAt,
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ runId, resetAt, snooze: false });
  });

  it("snoozes without enabling auto-resume", async () => {
    await click("Snooze until reset");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ runId, resetAt, snooze: true });
  });

  it("ignores recovery choices for another run", () => {
    expect(
      button("Resume at reset", {
        ...base,
        recovery: { runId: RunId.make("old-run"), resetAt, autoResume: true, snooze: true },
        snoozedUntil: resetAt,
      }),
    ).toBeDefined();
  });

  it("offers resume now, but no new snooze, after a valid reset", () => {
    vi.setSystemTime(new Date("2026-10-06T14:00:00.000Z"));
    expect(button("Resume now").props.disabled).toBe(false);
    expect(button("Snooze until reset").props.disabled).toBe(true);
  });

  it("rejects snoozing if reset passes between rendering and clicking", async () => {
    const snooze = button("Snooze until reset");
    vi.setSystemTime(new Date("2026-10-06T14:00:00.000Z"));
    (snooze.props.onClick as () => void)();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      visitElements(render(), (element) => element.props.role === "alert")?.props.children,
    ).toContain("reset time has passed");
  });

  it("shows save failures and allows another attempt", async () => {
    onChange.mockRejectedValueOnce(new Error("Connection lost"));
    await click("Resume at reset");
    expect(
      visitElements(render(), (element) => element.props.role === "alert")?.props.children,
    ).toBe("Connection lost");
    expect(button("Resume at reset").props.disabled).toBe(false);
  });
});
