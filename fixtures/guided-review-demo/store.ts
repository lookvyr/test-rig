import type { Reminder, ReminderStatus } from "./types";

const DUE_SOON_MS = 60 * 60 * 1000;

export function reminderStatus(reminder: Reminder, now: number): ReminderStatus {
  if (reminder.completedAt !== null) return "done";
  if (reminder.dueAt < now) return "overdue";
  if (reminder.dueAt - now <= DUE_SOON_MS) return "due-soon";
  return "upcoming";
}

export function addReminder(
  reminders: ReadonlyArray<Reminder>,
  input: { id: string; text: string; dueAt: number },
): Reminder[] {
  if (input.text.trim().length === 0) throw new Error("A reminder needs text.");
  if (reminders.some((reminder) => reminder.id === input.id)) return [...reminders];
  return [...reminders, { ...input, text: input.text.trim(), completedAt: null }];
}

export function completeReminder(
  reminders: ReadonlyArray<Reminder>,
  id: string,
  now: number,
): Reminder[] {
  return reminders.map((reminder) =>
    reminder.id === id && reminder.completedAt === null ? { ...reminder, completedAt: now } : reminder,
  );
}

/** Overdue first, then by due time; completed reminders sink to the end. */
export function sortReminders(reminders: ReadonlyArray<Reminder>, now: number): Reminder[] {
  const rank: Record<ReminderStatus, number> = { overdue: 0, "due-soon": 1, upcoming: 2, done: 3 };
  return [...reminders].sort(
    (a, b) =>
      rank[reminderStatus(a, now)] - rank[reminderStatus(b, now)] || a.dueAt - b.dueAt,
  );
}
