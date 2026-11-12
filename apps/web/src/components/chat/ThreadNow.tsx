import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { cn } from "~/lib/utils";
import { InlineButton } from "../ui/button";

/** A line of thread state for the end of the timeline. */
export interface ThreadNowItem {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

/** Every line at the end of the timeline shares this shape, so they read as one family. */
const lineClassName = cn(
  "mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
  // Inline actions keep their text size but get a finger-sized hit area on touch.
  "pointer-coarse:[&_[data-slot=inline-button]]:relative pointer-coarse:[&_[data-slot=inline-button]]:after:absolute pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-x-1.5 pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-y-3.5",
  "transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
);

/** One line of thread state at the end of the timeline: icon, title, detail, then actions. */
function ThreadNowLine({ item }: { readonly item: ThreadNowItem }) {
  return (
    <div className={cn(lineClassName, "items-baseline")} data-thread-now-line={item.id}>
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center self-center">
        {item.icon}
      </span>
      {/* Title and detail give way before the actions, so Stop stays reachable. */}
      <span className="min-w-0 truncate">
        {item.title}
        {item.description ? (
          <>
            {" "}
            <span className="ms-0.5 text-muted-foreground/60">{item.description}</span>
          </>
        ) : null}
      </span>
      {item.actions ? (
        <span className="ms-1.5 flex shrink-0 items-baseline gap-2.5">{item.actions}</span>
      ) : null}
    </div>
  );
}

/**
 * A thread lifecycle state with its way out: "Snoozed, 2h left · Wake now",
 * "Settled 3h ago · Un-settle", "Woke from snooze · Dismiss".
 */
export function ThreadStatusLine(props: {
  readonly icon: ReactNode;
  /** Stable wording for screen readers, so a ticking relative time is not re-announced. */
  readonly announcement: string;
  readonly label: string;
  readonly actionLabel: string;
  readonly actionDisabled?: boolean;
  readonly onAction: () => void;
}) {
  return (
    <div className={lineClassName} data-thread-status-line="true">
      <span role="status" className="sr-only">
        {props.announcement}
      </span>
      {props.icon}
      <span aria-hidden className="min-w-0 truncate">
        {props.label}
      </span>
      <span aria-hidden="true">·</span>
      <InlineButton disabled={props.actionDisabled} onClick={props.onAction}>
        {props.actionLabel}
      </InlineButton>
    </div>
  );
}

/**
 * What the thread is doing now, at the end of the timeline: background work,
 * the sync status while messages load, the goal, then its lifecycle status.
 */
export function ThreadNow({
  work,
  syncPhase,
  goal,
  status,
}: {
  readonly work: ThreadNowItem | null;
  readonly syncPhase: ThreadSyncPhase | null;
  readonly goal: ThreadNowItem | null;
  readonly status: ReactNode;
}): ReactNode {
  return (
    <>
      {work ? <ThreadNowLine item={work} /> : null}
      {syncPhase ? (
        <div className={lineClassName} role="status" data-thread-sync-status={syncPhase}>
          <RefreshCwIcon aria-hidden />
          <span className="truncate">{threadSyncLabel(syncPhase)}</span>
        </div>
      ) : null}
      {goal ? <ThreadNowLine item={goal} /> : null}
      {status}
    </>
  );
}
