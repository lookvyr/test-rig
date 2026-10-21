import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { CheckIcon, ChevronDownIcon, CircleDotIcon, CircleIcon, ListTodoIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

export interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  /** The list belongs to a turn that is still running. */
  readonly live: boolean;
}

export interface ComposerTaskStep {
  readonly durationMs?: number;
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

const MAX_TASK_SEGMENTS = 10;

const taskStatusLabels = {
  pending: "Pending",
  inProgress: "Running",
  completed: "Completed",
} satisfies Record<ComposerTaskStep["status"], string>;

function keyedTaskSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

/** Picks the summary line for a task list: the running task, else the next one, else the last. */
export function composerTasksProgress(
  steps: readonly ComposerTaskStep[],
  live: boolean,
): ComposerTasksProgress | null {
  const last = steps.at(-1);
  if (last === undefined) return null;
  return {
    step:
      steps.find((candidate) => candidate.status === "inProgress")?.step ??
      steps.find((candidate) => candidate.status === "pending")?.step ??
      last.step,
    completedSteps: steps.filter((candidate) => candidate.status === "completed").length,
    totalSteps: steps.length,
    live,
  };
}

function TaskSegments({ steps }: { readonly steps: readonly ComposerTaskStep[] }) {
  if (steps.length <= 1 || steps.length > MAX_TASK_SEGMENTS) return null;
  return (
    <span aria-hidden className="hidden w-20 shrink-0 items-center gap-0.5 sm:flex">
      {keyedTaskSteps(steps).map(({ key, step }) => (
        <span
          key={key}
          className={cn(
            "h-[3px] min-w-0 flex-1 rounded-full",
            step.status === "completed"
              ? "bg-success"
              : step.status === "inProgress"
                ? "bg-primary"
                : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The agent's task list, shown above the composer. Collapsed, it names the
 * current task and the progress; expanded, it lists every task.
 */
export const ComposerTasksBadge = memo(function ComposerTasksBadge({
  expanded,
  onToggle,
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (progress.totalSteps <= 0) return null;
  const done = progress.completedSteps >= progress.totalSteps;

  return (
    <div
      className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-[18px] border border-border bg-popover text-xs text-popover-foreground shadow-sm"
      data-composer-tasks="true"
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse tasks" : "Tasks"}: ${progress.completedSteps} of ${progress.totalSteps} complete. Current task: ${progress.step}`}
        data-composer-tasks-badge="true"
        onPointerDown={(event) => {
          // Keep composer focus so typing and Escape keep working.
          event.preventDefault();
        }}
        onClick={onToggle}
      >
        <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 text-muted-foreground">Tasks</span>
        <span
          className="min-w-0 flex-1 truncate font-medium text-foreground/80"
          data-composer-task-current="true"
        >
          {progress.step}
        </span>
        <span
          className={cn("shrink-0 tabular-nums", done ? "text-success" : "text-muted-foreground")}
          data-composer-task-progress="true"
        >
          {progress.completedSteps}/{progress.totalSteps}
        </span>
        <TaskSegments steps={steps} />
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded ? "rotate-180" : null,
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul
          className="max-h-56 overflow-y-auto border-t border-border/60 px-3 py-1.5"
          aria-label={`Task list. ${progress.completedSteps} of ${progress.totalSteps} complete.`}
          data-composer-tasks-list="true"
        >
          {keyedTaskSteps(steps).map(({ key, step }) => (
            <li key={key} className="flex items-start gap-2 py-1">
              <span
                className={cn(
                  "flex h-4 shrink-0 items-center [&_svg]:size-3.5",
                  step.status === "completed"
                    ? "text-success"
                    : step.status === "inProgress"
                      ? "text-primary"
                      : "text-muted-foreground/40",
                )}
                aria-hidden
              >
                {step.status === "completed" ? (
                  <CheckIcon />
                ) : step.status === "inProgress" ? (
                  <CircleDotIcon />
                ) : (
                  <CircleIcon />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 wrap-anywhere",
                  step.status === "completed"
                    ? "text-muted-foreground/55"
                    : step.status === "inProgress"
                      ? "text-foreground/90"
                      : "text-muted-foreground/70",
                )}
              >
                <span className="sr-only">{taskStatusLabels[step.status]}: </span>
                {step.step}
              </span>
              <span
                className="w-12 shrink-0 text-right text-3xs/4 text-muted-foreground/45 tabular-nums"
                data-composer-task-duration="true"
              >
                {step.durationMs !== undefined
                  ? formatDuration(step.durationMs)
                  : step.status === "inProgress" && progress.live
                    ? "now"
                    : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
