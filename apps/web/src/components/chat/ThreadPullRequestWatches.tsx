import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { EyeIcon, EyeOffIcon, GitPullRequestIcon, PauseIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS } from "./threadDetailsPanelStyles";

/** Shows active PR monitors from the thread shell; stopping a watch never unlinks its PR. */
export function ThreadPullRequestWatches({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  const openPrLink = useOpenPrLink();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const paused = thread?.settledOverride === "settled" || thread?.settledAt != null;
  const links = visibleThreadPullRequests(thread?.pullRequests ?? []).filter(
    (link) => link.watch != null && (link.snapshot?.state ?? "open") === "open",
  );
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
          aria-label={link.url}
          onClick={(event) => openPrLink(event, link.url)}
        >
          <GitPullRequestIcon />
          <span className="truncate">
            #{link.number}
            {link.snapshot ? `: ${link.snapshot.title}` : ""}
          </span>
        </ThreadDetailsControl>
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
            {paused ? (
              <PauseIcon
                aria-hidden
                className="size-4 text-muted-foreground group-hover/watch:hidden"
              />
            ) : (
              <EyeIcon aria-hidden className="size-4 group-hover/watch:hidden" />
            )}
            <EyeOffIcon aria-hidden className="hidden size-4 group-hover/watch:block" />
          </TooltipTrigger>
          <TooltipPopup>
            {paused
              ? "Watching paused while this thread is settled. Un-settle the thread to resume watching."
              : "Watching: the agent wakes when checks finish, someone comments, or the branch conflicts."}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  });
}
