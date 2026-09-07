import type { GitGetPullRequestDetailsResult } from "@t3tools/contracts";
import { ArrowRightIcon, GitBranchIcon, MessageSquareIcon } from "lucide-react";
import {
  type PullRequestDraftDestination,
  usePullRequestHandoff,
} from "../../hooks/usePullRequestHandoff";
import type { PullRequestWorkspaceEntry } from "../../pullRequestWorkspaceStore";
import { useThreadShells } from "../../state/entities";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import type { PullRequestSelection } from "./workspaceStore";

/** Choosing a destination prepares its draft; opening the saved link only navigates. */
export function PullRequestConversationActions({
  selection,
  details,
  entry,
  canPrepare,
}: {
  selection: PullRequestSelection;
  details: GitGetPullRequestDetailsResult;
  entry: Pick<PullRequestWorkspaceEntry, "linkedTarget">;
  canPrepare: boolean;
}) {
  const pr = details.pullRequest;
  const scope = {
    environmentId: selection.environmentId,
    cwd: selection.cwd,
    reference: pr.url,
  };
  const handoff = usePullRequestHandoff({
    ...scope,
    projectId: selection.projectId,
    pullRequest: { ...pr, body: details.body },
  });
  const threads = useThreadShells();
  const destinations = threads.filter(
    (thread) =>
      thread.environmentId === selection.environmentId &&
      thread.projectId === selection.projectId &&
      thread.archivedAt === null &&
      thread.sideOfThreadId == null,
  );
  const linkedThread = destinations.find((thread) => thread.id === entry.linkedTarget?.threadId);
  const otherThreads = destinations.filter((thread) => thread.id !== entry.linkedTarget?.threadId);
  const prepareDraft = (destination: PullRequestDraftDestination) => {
    if (handoff.isPending || !canPrepare) return;
    void handoff.prepareDraft(destination);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
        <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-32">
          <p className="text-[11px] font-medium text-muted-foreground">Review thread</p>
          <p className="truncate text-xs" title={linkedThread?.title}>
            {entry.linkedTarget
              ? (linkedThread?.title ??
                (entry.linkedTarget.draftId
                  ? `PR #${pr.number} review draft`
                  : "Unavailable thread"))
              : "No thread linked"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {entry.linkedTarget && (
            <Button
              size="sm"
              variant="outline"
              disabled={handoff.isPending}
              onClick={() => void handoff.openLinkedConversation()}
            >
              Open
              <ArrowRightIcon />
            </Button>
          )}
          <Menu>
            <MenuTrigger
              disabled={handoff.isPending || !canPrepare}
              render={<Button size="sm" variant={entry.linkedTarget ? "ghost" : "outline"} />}
            >
              {entry.linkedTarget ? "Change…" : "Choose review thread…"}
            </MenuTrigger>
            <MenuPopup align="end" className="w-80 max-w-[calc(100vw-2rem)]">
              <MenuItem onClick={() => prepareDraft({ kind: "new" })}>
                <GitBranchIcon />
                <span className="min-w-0">
                  <span className="block">New PR worktree</span>
                  <span className="block text-xs text-muted-foreground">
                    Create a thread on this pull request’s branch
                  </span>
                </span>
              </MenuItem>
              {otherThreads.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>Existing threads · current checkout</MenuGroupLabel>
                    {otherThreads.map((thread) => (
                      <MenuItem
                        key={thread.id}
                        onClick={() => prepareDraft({ kind: "existing", threadId: thread.id })}
                      >
                        <MessageSquareIcon />
                        <span className="truncate" title={thread.title}>
                          {thread.title}
                        </span>
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </>
              )}
              <p className="px-2 py-2 text-xs text-muted-foreground">
                Choosing a thread opens an unsent draft with PR context and selected notes.
              </p>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {handoff.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Opening review thread…
        </p>
      )}
      {handoff.error && (
        <p role="alert" className="text-xs text-destructive">
          {handoff.error}
        </p>
      )}
    </div>
  );
}
