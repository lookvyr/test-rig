import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";

export interface PullRequestHandoffInput {
  environmentId: EnvironmentId;
  cwd: string;
  projectId: ProjectId;
  reference: string;
}

/** Open an editable draft; its persisted PR target blocks Send until preparation succeeds. */
export function createPullRequestDraft(input: PullRequestHandoffInput) {
  const draftId = newDraftId();
  const composer = useComposerDraftStore.getState();
  composer.setLogicalProjectDraftThreadId(
    `pull-request:${draftId}`,
    scopeProjectRef(input.environmentId, input.projectId),
    draftId,
    {
      threadId: newThreadId(),
      envMode: "worktree",
      startFromOrigin: false,
      pullRequestReference: input.reference,
    },
  );
  composer.applyStickyState(draftId);
  composer.setPrompt(draftId, input.reference);
  return draftId;
}

export function usePullRequestHandoff(input: PullRequestHandoffInput) {
  const navigate = useNavigate();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startReview = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setError(null);
    try {
      const draftId = createPullRequestDraft(input);
      await navigate({ to: "/draft/$draftId", params: { draftId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the review draft.");
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  };
  return { startReview, isPending, error };
}
