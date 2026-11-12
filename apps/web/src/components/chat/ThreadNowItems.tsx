import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import {
  presentPendingBackgroundWork,
  type ProviderGoalPresentation,
} from "@t3tools/client-runtime/state/thread-execution";
import { commandDisplayText } from "@t3tools/client-runtime/work-log/command-label";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";
import { CircleDashedIcon, TargetIcon, TerminalIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { tickTextContent } from "~/lib/tickTextContent";
import { InlineButton } from "../ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { CommandOutputPanel, useCommandOutputStreaming } from "./CommandOutputPanel";
import type { ThreadNowItem } from "./ThreadNow";

/**
 * The turn item a pending task came from. Claude background commands name it;
 * Codex commands and subagents are keyed by its native id.
 */
function findTaskItem(
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
  task: Pick<OrchestrationV2PendingBackgroundTask, "taskId" | "itemId">,
): OrchestrationV2TurnItem | undefined {
  return task.itemId === undefined
    ? turnItems.findLast(
        (candidate) => (candidate.nativeItemRef?.nativeId || candidate.id) === task.taskId,
      )
    : turnItems.findLast((candidate) => candidate.id === task.itemId);
}

/** Whole seconds, so a ticking label never shows tenths: "5s", "42s", "3m 5s". */
function formatElapsed(elapsedMs: number): string {
  return formatDuration(Math.max(1, Math.floor(elapsedMs / 1_000)) * 1_000).replace(/\.0s$/u, "s");
}

/** Background commands and subagents, for the end of the timeline. */
export function backgroundWorkNowItem(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly stopDisabled: boolean;
  readonly stopping: boolean;
  readonly onStop: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}): ThreadNowItem | null {
  const { onOpenThread } = input;
  const presentation = presentPendingBackgroundWork(input.tasks);
  if (presentation === null) return null;
  const rows = presentation.items.map((task) => {
    const source = input.tasks.find((candidate) => candidate.taskId === task.taskId);
    const item = findTaskItem(input.turnItems, source ?? task);
    const subagent = item?.type === "subagent" ? item : undefined;
    return {
      task,
      label:
        item?.type === "command_execution" && commandDisplayText(item.input) === task.label ? (
          <span className="font-mono">{task.label}</span>
        ) : (
          task.label
        ),
      activity: subagent?.progress?.replace(/\s+/gu, " ").trim() || null,
      startedAtMs: item?.startedAt ? DateTime.toEpochMillis(item.startedAt) : null,
      updatedAtMs: subagent ? DateTime.toEpochMillis(subagent.updatedAt) : 0,
      childThreadId: task.childThreadId ?? subagent?.childThreadId ?? undefined,
    };
  });
  const [only] = rows.length === 1 ? rows : [];
  const newest = rows
    .filter((row) => row.activity)
    .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs)[0];
  const onlyThreadId = only?.childThreadId;
  const startedAtMs = only?.startedAtMs ?? null;
  return {
    id: `background-work:${input.threadId}`,
    icon: rows.every((row) => row.task.kind !== "subagent") ? (
      <TerminalIcon />
    ) : (
      <CircleDashedIcon />
    ),
    title:
      only && typeof only.label !== "string" ? (
        <>
          {presentation.waiting ? "Waiting" : "Running"} · {only.label}
        </>
      ) : (
        presentation.title
      ),
    description: only ? (
      only.activity
    ) : newest ? (
      <>
        {newest.label}: {newest.activity}
      </>
    ) : (
      rows.map((row, index) => (
        <Fragment key={row.task.taskId}>
          {index > 0 ? ", " : null}
          {row.label}
        </Fragment>
      ))
    ),
    actions: (
      <>
        {startedAtMs === null ? null : (
          <span
            ref={tickTextContent((nowMs) => formatElapsed(nowMs - startedAtMs), true)}
            className="tabular-nums"
          />
        )}
        <BackgroundWorkDetails
          environmentId={input.environmentId}
          threadId={input.threadId}
          tasks={input.tasks}
          turnItems={input.turnItems}
          onOpenThread={onOpenThread}
        />
        {onlyThreadId === undefined ? null : (
          <InlineButton tone="muted" onClick={() => onOpenThread(onlyThreadId)}>
            Open
          </InlineButton>
        )}
        <InlineButton disabled={input.stopDisabled} onClick={input.onStop}>
          {input.stopping ? "Stopping..." : "Stop"}
        </InlineButton>
      </>
    ),
  };
}

/** A native `/goal`, for the end of the timeline. Resume and Clear wait for the turn to end. */
export function goalNowItem(input: {
  readonly threadId: ThreadId;
  readonly presentation: ProviderGoalPresentation;
  readonly working: boolean;
  /** The thread cannot take a command right now, such as while a request is pending. */
  readonly disabled: boolean;
  readonly onResume: () => void;
  readonly onClear: () => void;
}): ThreadNowItem {
  const { presentation } = input;
  return {
    id: `goal:${input.threadId}`,
    icon: <TargetIcon />,
    title:
      presentation.usage === null
        ? presentation.title
        : `${presentation.title} · ${presentation.usage}`,
    description: presentation.objective,
    actions: input.working ? undefined : (
      <>
        {presentation.canResume ? (
          <>
            <InlineButton disabled={input.disabled} onClick={input.onResume}>
              Resume
            </InlineButton>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <InlineButton tone="muted" disabled={input.disabled} onClick={input.onClear}>
          Clear
        </InlineButton>
      </>
    ),
  };
}

/** Each background task in full: its command, live output while it runs, and its thread. */
function BackgroundWorkDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const streamsOutput = useCommandOutputStreaming(props.environmentId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<InlineButton tone="muted" />}>Details</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Background work</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-5">
            {props.tasks.map((task) => {
              const item = findTaskItem(props.turnItems, task);
              const command =
                task.command ?? (item?.type === "command_execution" ? item.input : undefined);
              const description = task.description?.trim();
              const title =
                description && description !== command?.trim()
                  ? description
                  : command
                    ? "Command"
                    : task.kind.replaceAll("_", " ");
              const childThreadId =
                task.kind === "subagent"
                  ? (task.childThreadId ??
                    (item?.type === "subagent" ? (item.childThreadId ?? undefined) : undefined))
                  : undefined;
              return (
                <section key={task.taskId} className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium first-letter:uppercase">{title}</h3>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {backgroundWorkHoldsCompletion([task]) ? "Waiting" : "Running"}
                    </span>
                  </div>
                  {command ? (
                    <pre className="rounded-md border border-border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      {command}
                    </pre>
                  ) : null}
                  {item?.type === "command_execution" &&
                  streamsOutput &&
                  item.status === "running" ? (
                    <div className="font-mono text-xs whitespace-pre-wrap break-words">
                      <CommandOutputPanel
                        environmentId={props.environmentId}
                        threadId={task.sourceThreadId ?? item.threadId}
                        itemId={item.id}
                      />
                    </div>
                  ) : null}
                  {childThreadId ? (
                    <InlineButton
                      onClick={() => {
                        setOpen(false);
                        props.onOpenThread(childThreadId);
                      }}
                    >
                      Open thread
                    </InlineButton>
                  ) : null}
                </section>
              );
            })}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
