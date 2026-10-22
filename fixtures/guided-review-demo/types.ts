/** A reminder the user asked to be nudged about. */
export interface Reminder {
  readonly id: string;
  readonly text: string;
  /** Epoch milliseconds. */
  readonly dueAt: number;
  readonly completedAt: number | null;
}

export type ReminderStatus = "upcoming" | "due-soon" | "overdue" | "done";
