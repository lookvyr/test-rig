import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { EyeIcon, EyeOffIcon, GitPullRequestIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

/** The thread's watched open PRs, which wake the agent when they change. */
export function useWatchedThreadPullRequests(
  threadRef: ScopedThreadRef,
): ReadonlyArray<ThreadPullRequestLink> {
  const thread = useThreadShell(threadRef);
  const settled = thread?.settledOverride === "settled" || thread?.settledAt != null;
  return visibleThreadPullRequests(thread?.pullRequests ?? []).filter(
    (link) => !settled && link.watch != null && (link.snapshot?.state ?? "open") === "open",
  );
}

/**
 * One row per watched PR: the row opens PR details (or the PR itself when the
 * thread has no details panel) and the eye stops watching without unlinking.
 */
export function ThreadPullRequestWatches({
  threadRef,
  links,
  onShowPullRequest,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly links: ReadonlyArray<ThreadPullRequestLink>;
  readonly onShowPullRequest: (() => void) | undefined;
}) {
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  const openPrLink = useOpenPrLink();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  async function stopWatching(link: ThreadPullRequestLink) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await watch({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          host: link.host,
          repository: link.repository,
          number: link.number,
          watching: false,
        },
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return links.map((link) => {
    const key = `${link.host}/${link.repository}#${link.number}`;
    return (
      <div key={key} className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS} data-thread-pr-watch>
        <ThreadDetailsControl
          part="primary"
          className="min-w-0"
          aria-label={`Open PR #${link.number}`}
          onClick={(event) =>
            onShowPullRequest ? onShowPullRequest() : openPrLink(event, link.url)
          }
        >
          <GitPullRequestIcon />
          <span className="truncate">
            #{link.number}
            {link.snapshot ? `: ${link.snapshot.title}` : ""}
          </span>
        </ThreadDetailsControl>
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                part="secondary"
                className="group/watch"
                aria-label={`Stop watching #${link.number}`}
                disabled={pending}
                onClick={() => void stopWatching(link)}
              />
            }
          >
            <EyeIcon aria-hidden className="size-4 group-hover/watch:hidden" />
            <EyeOffIcon aria-hidden className="hidden size-4 group-hover/watch:block" />
          </TooltipTrigger>
          <TooltipPopup>
            Watching: the agent wakes when checks finish, someone comments, the branch conflicts, or
            approval or merge readiness changes. Click to stop.
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  });
}
