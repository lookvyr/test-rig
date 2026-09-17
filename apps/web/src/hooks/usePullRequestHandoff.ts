import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { usePreparePullRequestThreadAction } from "../lib/sourceControlActions";

export interface PullRequestHandoffInput {
  environmentId: EnvironmentId;
  cwd: string;
  projectId: ProjectId;
  reference: string;
}

/** Prepare the checkout before creating a draft; each review keeps its own unsent text. */
export async function preparePullRequestDraft(
  input: PullRequestHandoffInput,
  prepare: (threadId: ThreadId) => Promise<{ branch: string; worktreePath: string | null }>,
) {
  const threadId = newThreadId();
  const prepared = await prepare(threadId);
  const draftId = newDraftId();
  const composer = useComposerDraftStore.getState();
  composer.setLogicalProjectDraftThreadId(
    `pull-request:${draftId}`,
    scopeProjectRef(input.environmentId, input.projectId),
    draftId,
    {
      threadId,
      branch: prepared.branch,
      worktreePath: prepared.worktreePath,
      envMode: "worktree",
      startFromOrigin: false,
    },
  );
  composer.applyStickyState(draftId);
  composer.setPrompt(draftId, input.reference);
  return draftId;
}

export function usePullRequestHandoff(input: PullRequestHandoffInput) {
  const navigate = useNavigate();
  const prepareAction = usePreparePullRequestThreadAction(input);
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startReview = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setError(null);
    try {
      const draftId = await preparePullRequestDraft(input, async (threadId) => {
        const result = await prepareAction.run({
          reference: input.reference,
          mode: "worktree",
          threadId,
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return result.value;
      });
      await navigate({ to: "/draft/$draftId", params: { draftId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the review thread.");
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };
  return { startReview, isPending, error };
}
