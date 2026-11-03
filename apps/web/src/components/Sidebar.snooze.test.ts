import { describe, expect, it } from "vite-plus/test";

import { pickSnoozePreset, resolveSnoozePresets, snoozeWakeDescription } from "./Sidebar.snooze";

// Local-time constructor so preset math is timezone-stable in tests.
function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("resolveSnoozePresets", () => {
  it("offers hour, three hours, evening, tomorrow, next week in the morning", () => {
    // Wednesday 2026-04-08 10:00 local.
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale");
    expect(presets.map((preset) => preset.id)).toEqual([
      "after:60",
      "after:180",
      "at:today:18:00",
      "at:tomorrow:09:00",
      "at:monday:09:00",
    ]);
    const evening = presets.find((preset) => preset.id === "at:today:18:00");
    expect(new Date(evening!.snoozedUntil).getHours()).toBe(18);
    const tomorrow = presets.find((preset) => preset.id === "at:tomorrow:09:00");
    const tomorrowDate = new Date(tomorrow!.snoozedUntil);
    expect(tomorrowDate.getDate()).toBe(9);
    expect(tomorrowDate.getHours()).toBe(9);
    const nextWeek = presets.find((preset) => preset.id === "at:monday:09:00");
    const nextWeekDate = new Date(nextWeek!.snoozedUntil);
    expect(nextWeekDate.getDay()).toBe(1);
    expect(nextWeekDate.getDate()).toBe(13);
  });

  it("whenLabel complements the label instead of repeating it", () => {
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale");
    for (const preset of presets) {
      // Day words live in the label column; the time column is time-only
      // (plus a weekday for next week, which names a different day).
      expect(preset.whenLabel.toLowerCase()).not.toContain("tomorrow");
    }
    const tomorrow = presets.find((preset) => preset.id === "at:tomorrow:09:00");
    expect(tomorrow!.whenLabel).toMatch(/9/);
    const nextWeek = presets.find((preset) => preset.id === "at:monday:09:00");
    expect(nextWeek!.whenLabel).toMatch(/Mon/);
  });

  it("lists options soonest first and drops the evening preset once evening has passed", () => {
    expect(
      resolveSnoozePresets(localDate(2026, 4, 8, 17, 30), "locale").map((preset) => preset.id),
    ).toEqual(["at:today:18:00", "after:60", "after:180", "at:tomorrow:09:00", "at:monday:09:00"]);
    expect(
      resolveSnoozePresets(localDate(2026, 4, 8, 21), "locale").map((preset) => preset.id),
    ).toEqual(["after:60", "after:180", "at:tomorrow:09:00", "at:monday:09:00"]);
  });

  it("puts next week a full week out when today is Monday", () => {
    // Monday 2026-04-06.
    const presets = resolveSnoozePresets(localDate(2026, 4, 6, 10), "locale");
    const nextWeek = new Date(
      presets.find((preset) => preset.id === "at:monday:09:00")!.snoozedUntil,
    );
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getDate()).toBe(13);
  });
  it("formats preset times with the selected clock preference", () => {
    const twelveHour = resolveSnoozePresets(localDate(2026, 4, 8, 10), "12-hour");
    const twentyFourHour = resolveSnoozePresets(localDate(2026, 4, 8, 10), "24-hour");

    expect(twelveHour.find((preset) => preset.id === "at:today:18:00")!.whenLabel).toMatch(/PM/i);
    expect(twentyFourHour.find((preset) => preset.id === "at:today:18:00")!.whenLabel).toBe(
      "18:00",
    );
  });
});

describe("pickSnoozePreset", () => {
  it("refuses a choice whose time passed while the menu was open", () => {
    const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const shown = [
      { id: "at:today:18:00", label: "This evening", whenLabel: "", snoozedUntil: at(-1_000) },
      { id: "after:60", label: "In 1 hour", whenLabel: "", snoozedUntil: at(3_600_000) },
    ];
    expect(pickSnoozePreset(shown, "at:today:18:00")).toBeUndefined();
    expect(pickSnoozePreset(shown, "after:60")?.id).toBe("after:60");
  });
});

describe("snoozeWakeDescription", () => {
  const now = localDate(2026, 4, 8, 10);

  it("uses bare time today, 'tomorrow' next day, weekday within the week", () => {
    expect(
      snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "locale"),
    ).not.toContain("tomorrow");
    expect(snoozeWakeDescription(localDate(2026, 4, 9, 9).toISOString(), now, "locale")).toContain(
      "tomorrow",
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 13, 9).toISOString(), now, "locale")).toMatch(
      /Mon/,
    );
  });

  it("formats wake descriptions with the selected clock preference", () => {
    expect(snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "12-hour")).toMatch(
      /PM/i,
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "24-hour")).toBe(
      "18:00",
    );
  });
});
