import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  PullRequestContextMetadata,
  PullRequestReviewThread,
} from "@t3tools/contracts";
import type { ReviewCommentContext } from "../reviewCommentContext";
import { useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import {
  buildPullRequestCommentContext,
  buildPullRequestReferenceContext,
  type PullRequestChatSubject,
  appendHandoff,
} from "../components/pullRequest/pullRequestDetail.logic";
import { toastManager } from "../components/ui/toast";

export interface PullRequestHandoffInput {
  environmentId: EnvironmentId;
  cwd: string;
  projectId: ProjectId;
  reference: string;
}

/** Open an editable draft; its persisted PR target blocks Send until preparation succeeds. */
export function createPullRequestDraft(
  input: PullRequestHandoffInput,
  kind: "checkout" | "question" = "checkout",
) {
  const draftId = newDraftId();
  const composer = useComposerDraftStore.getState();
  composer.setLogicalProjectDraftThreadId(
    `pull-request:${draftId}`,
    scopeProjectRef(input.environmentId, input.projectId),
    draftId,
    {
      threadId: newThreadId(),
      ...(kind === "checkout"
        ? {
            envMode: "worktree" as const,
            startFromOrigin: false,
            pullRequestReference: input.reference,
          }
        : {}),
    },
  );
  composer.applyStickyState(draftId);
  composer.setPrompt(draftId, input.reference);
  return draftId;
}

interface HandoffTask {
  prompt: string;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
}

/** Attach the cited words and their PR to the existing composer without changing its prompt. */
export function attachPullRequestDiscussion(
  target: ScopedThreadRef,
  detail: PullRequestContextMetadata & {
    readonly reviewThreads: readonly PullRequestReviewThread[];
  },
  subject: PullRequestChatSubject,
) {
  const thread =
    subject.kind === "comment"
      ? detail.reviewThreads.find((candidate) =>
          candidate.comments.some((entry) => entry.id === subject.comment.id),
        )
      : undefined;
  const comment = buildPullRequestCommentContext(
    detail,
    thread ? { kind: "thread", thread } : subject,
  );
  if (!comment) return false;
  const store = useComposerDraftStore.getState();
  if (
    !store
      .getComposerDraft(target)
      ?.reviewComments.some((entry) => entry.pullRequest?.url === detail.url)
  ) {
    store.addReviewComment(target, buildPullRequestReferenceContext(detail));
  }
  store.addReviewComment(target, comment);
  return true;
}

/** Add the requested work to the open thread while preserving the user's unsent text and attachments. */
export function attachPullRequestTask(target: ScopedThreadRef, task: HandoffTask) {
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(target);
  const existing = draft?.reviewComments ?? [];
  const next = appendHandoff({ prompt: draft?.prompt ?? "", reviewComments: existing }, task);
  store.setPrompt(target, next.prompt);
  store.setReviewComments(target, next.reviewComments);
}

export function usePullRequestHandoff(input: PullRequestHandoffInput, target?: ScopedThreadRef) {
  const navigate = useNavigate();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startReview = async (handoff?: HandoffTask, kind: "checkout" | "question" = "checkout") => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setError(null);
    try {
      if (target && handoff) {
        attachPullRequestTask(target, handoff);
        toastManager.add({ type: "success", title: "Added to this thread’s composer" });
        return;
      }
      const draftId = createPullRequestDraft(input, kind);
      if (handoff) {
        const composer = useComposerDraftStore.getState();
        composer.setPrompt(draftId, handoff.prompt);
        composer.setReviewComments(draftId, handoff.reviewComments ?? []);
      }
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
