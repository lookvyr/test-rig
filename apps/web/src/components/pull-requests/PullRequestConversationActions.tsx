import type { GitGetPullRequestDetailsResult } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { usePullRequestHandoff } from "../../hooks/usePullRequestHandoff";
import {
  type PullRequestWorkspaceEntry,
  usePullRequestWorkspaceStore,
} from "../../pullRequestWorkspaceStore";
import { useThreadShells } from "../../state/entities";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { PullRequestSelect } from "./PullRequestSelect";
import type { PullRequestSelection } from "./workspaceStore";

/** Conversation selection belongs to the global PR workspace, not a linked thread. */
export function PullRequestConversationActions({
  selection,
  details,
  entry,
  canPrepare,
}: {
  selection: PullRequestSelection;
  details: GitGetPullRequestDetailsResult;
  entry: Pick<PullRequestWorkspaceEntry, "instructions" | "linkedTarget">;
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
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [destination, setDestination] = useState("new");
  const chosenThread = destinations.find((thread) => thread.id === destination);
  const setInstructions = usePullRequestWorkspaceStore((state) => state.setInstructions);
  const beginPreparation = () => {
    setDestination(
      destinations.find((thread) => thread.id === entry.linkedTarget?.threadId)?.id ?? "new",
    );
    if (!entry.instructions)
      setInstructions(
        scope,
        `Review ${details.repository} #${pr.number}. Explain the change and investigate the selected findings.`,
      );
    setPrepareOpen(true);
  };

  return (
    <div className="space-y-2">
      {prepareOpen ? (
        <>
          <label htmlFor="pr-destination" className="text-xs font-medium">
            Destination
          </label>
          <PullRequestSelect
            id="pr-destination"
            disabled={handoff.isPending}
            className="w-full"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="new">New conversation in a worktree</option>
            {destinations.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </PullRequestSelect>
          <p className="text-[11px] text-muted-foreground">
            {destination === "new"
              ? "Creates a worktree for this pull request."
              : "Uses the existing conversation and its current checkout."}
          </p>
          <label htmlFor="pr-handoff-instructions" className="text-xs font-medium">
            Instructions to add
          </label>
          <Textarea
            id="pr-handoff-instructions"
            value={entry.instructions}
            onChange={(event) => setInstructions(scope, event.target.value)}
            className="min-h-24 text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            PR context and selected notes are added to an unsent message. Review it before sending.
          </p>
          <Button
            className="w-full"
            size="sm"
            disabled={handoff.isPending || !canPrepare || (destination !== "new" && !chosenThread)}
            onClick={() => {
              if (destination === "new") void handoff.prepareDraft({ kind: "new" });
              else if (chosenThread)
                void handoff.prepareDraft({ kind: "existing", threadId: chosenThread.id });
            }}
          >
            {handoff.isPending ? "Preparing draft…" : "Open draft"}
            <ArrowRightIcon />
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            size="sm"
            disabled={handoff.isPending}
            onClick={() => setPrepareOpen(false)}
          >
            Cancel
          </Button>
        </>
      ) : entry.linkedTarget ? (
        <>
          <Button
            className="w-full"
            size="sm"
            disabled={handoff.isPending}
            onClick={() => void handoff.openLinkedConversation()}
          >
            Open conversation
            <ArrowRightIcon />
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            size="sm"
            disabled={handoff.isPending}
            onClick={beginPreparation}
          >
            Change conversation…
          </Button>
        </>
      ) : (
        <Button className="w-full" size="sm" onClick={beginPreparation}>
          Prepare agent draft
        </Button>
      )}
      {handoff.error && (
        <p role="alert" className="text-xs text-destructive">
          {handoff.error}
        </p>
      )}
    </div>
  );
}
