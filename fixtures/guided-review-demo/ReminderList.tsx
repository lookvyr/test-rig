import { formatDue } from "./format";
import { reminderStatus, sortReminders } from "./store";
import type { Reminder } from "./types";

export function ReminderList(props: {
  readonly reminders: ReadonlyArray<Reminder>;
  readonly now: number;
  readonly onComplete: (id: string) => void;
}) {
  return (
    <ul aria-label="Reminders">
      {sortReminders(props.reminders, props.now).map((reminder) => {
        const status = reminderStatus(reminder, props.now);
        return (
          <li key={reminder.id} data-status={status}>
            <span>{reminder.text}</span>
            <span>{status === "done" ? "Done" : formatDue(reminder.dueAt, props.now)}</span>
            {status !== "done" ? (
              <button type="button" onClick={() => props.onComplete(reminder.id)}>
                Complete
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
