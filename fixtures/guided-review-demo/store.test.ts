import { describe, expect, it } from "vite-plus/test";

import { addReminder, completeReminder, reminderStatus, sortReminders } from "./store";

const NOW = 1_000_000_000;

describe("reminders", () => {
  it("classifies by due time", () => {
    const base = { id: "a", text: "x", completedAt: null };
    expect(reminderStatus({ ...base, dueAt: NOW - 1 }, NOW)).toBe("overdue");
    expect(reminderStatus({ ...base, dueAt: NOW + 30 * 60 * 1000 }, NOW)).toBe("due-soon");
    expect(reminderStatus({ ...base, dueAt: NOW + 2 * 60 * 60 * 1000 }, NOW)).toBe("upcoming");
  });

  it("adds once, completes once, and sorts overdue first", () => {
    let reminders = addReminder([], { id: "a", text: " later ", dueAt: NOW + 10_000_000 });
    reminders = addReminder(reminders, { id: "b", text: "late", dueAt: NOW - 1 });
    reminders = addReminder(reminders, { id: "b", text: "dupe", dueAt: NOW });
    expect(reminders.map((reminder) => reminder.text)).toEqual(["later", "late"]);
    expect(sortReminders(reminders, NOW).map((reminder) => reminder.id)).toEqual(["b", "a"]);
    reminders = completeReminder(reminders, "b", NOW);
    expect(sortReminders(reminders, NOW).map((reminder) => reminder.id)).toEqual(["a", "b"]);
  });
});
