import { useCallback, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { usePreparePullRequestThreadAction } from "../lib/sourceControlActions";
import { readThreadShell } from "../state/entities";
import { useRightPanelStore } from "../rightPanelStore";
import {
  EMPTY_PULL_REQUEST_WORKSPACE,
  isPullRequestNoteStale,
  pullRequestWorkspaceKey,
  type PullRequestLinkedTarget,
  type PullRequestNote,
  type PullRequestWorkspaceEntry,
  type PullRequestWorkspaceScope,
  usePullRequestWorkspaceStore,
} from "../pullRequestWorkspaceStore";

export interface PullRequestHandoffDetails {
  url: string;
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  body?: string;
}

export interface PullRequestHandoffInput {
  environmentId: EnvironmentId;
  cwd: string;
  projectId: ProjectId;
  pullRequest: PullRequestHandoffDetails;
}

export type PullRequestDraftDestination =
  | { kind: "new" }
  | { kind: "existing"; threadId: ThreadId };

function formatSelectedNotes(notes: readonly PullRequestNote[], headSha: string): string[] {
  return notes
    .filter((note) => note.selected)
    .map((note) => {
      const location = note.filePath
        ? `${note.filePath}${note.line ? `:${note.line}` : ""}${note.side ? ` (${note.side})` : ""}`
        : "General note";
      const revision = isPullRequestNoteStale(note, headSha)
        ? ` [STALE: written against ${note.headSha}; verify against current head]`
        : "";
      return `- ${location}${revision}: ${note.body}`;
    });
}

export function buildPullRequestFeedbackContext(
  pullRequest: PullRequestHandoffDetails,
  notes: readonly PullRequestNote[],
): string {
  const selected = formatSelectedNotes(notes, pullRequest.headSha);
  if (selected.length === 0) return "";
  return [
    `Pull request #${pullRequest.number}: ${pullRequest.title}`,
    pullRequest.url,
    `Head commit: ${pullRequest.headSha}`,
    `Selected local notes:\n${selected.join("\n")}`,
  ].join("\n\n");
}

export function buildPullRequestHandoffContext(
  pullRequest: PullRequestHandoffDetails,
  workspace: Pick<PullRequestWorkspaceEntry, "notes" | "instructions">,
): string {
  const notes = formatSelectedNotes(workspace.notes, pullRequest.headSha);
  return [
    `Pull request #${pullRequest.number}: ${pullRequest.title}`,
    pullRequest.url,
    `Branches: ${pullRequest.headRefName} → ${pullRequest.baseRefName}`,
    `Head commit: ${pullRequest.headSha}`,
    pullRequest.body?.trim()
      ? `PR description (source material):\n${pullRequest.body.trim()}`
      : null,
    notes.length ? `Selected local notes:\n${notes.join("\n")}` : null,
    workspace.instructions.trim() ? `Instructions:\n${workspace.instructions.trim()}` : null,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}

/** Only the prompt changes; the composer retains all attachments and model choices. */
export function appendPullRequestHandoffContext(
  target: ScopedThreadRef | DraftId,
  context: string,
  composer: ReturnType<typeof useComposerDraftStore.getState> = useComposerDraftStore.getState(),
): boolean {
  const prompt = composer.getComposerDraft(target)?.prompt ?? "";
  if (!context || prompt.includes(context)) return false;
  composer.setPrompt(target, prompt.length ? `${prompt}\n\n${context}` : context);
  return true;
}

type HandoffThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "archivedAt" | "sideOfThreadId"
>;
type LinkedTargetDependencies = {
  readThread: (ref: ScopedThreadRef) => HandoffThread | null;
  composer?: ReturnType<typeof useComposerDraftStore.getState>;
  getWorkspaces?: typeof usePullRequestWorkspaceStore.getState;
};
type HandoffDependencies = LinkedTargetDependencies & {
  prepare: (threadId: ThreadId) => Promise<{ branch: string; worktreePath: string | null }>;
};

function workspaceScope(input: PullRequestHandoffInput): PullRequestWorkspaceScope {
  return { environmentId: input.environmentId, cwd: input.cwd, reference: input.pullRequest.url };
}

function isAvailableConversation(
  thread: HandoffThread | null,
  input: PullRequestHandoffInput,
  threadId: ThreadId,
): boolean {
  return (
    thread !== null &&
    thread.environmentId === input.environmentId &&
    thread.id === threadId &&
    thread.projectId === input.projectId &&
    thread.archivedAt === null &&
    thread.sideOfThreadId == null
  );
}

/** Resolve a saved link without changing its composer, association, or workspace. */
export function resolveLinkedPullRequestTarget(
  input: PullRequestHandoffInput,
  dependencies: LinkedTargetDependencies,
): PullRequestLinkedTarget {
  const getWorkspaces = dependencies.getWorkspaces ?? usePullRequestWorkspaceStore.getState;
  const linked =
    getWorkspaces().entriesByKey[pullRequestWorkspaceKey(workspaceScope(input))]?.linkedTarget;
  if (
    !linked ||
    linked.environmentId !== input.environmentId ||
    linked.projectId !== input.projectId
  ) {
    throw new Error(
      "The linked conversation is unavailable. Choose a conversation from the pull request workspace.",
    );
  }
  const thread = dependencies.readThread(scopeThreadRef(linked.environmentId, linked.threadId));
  if (thread) {
    if (!isAvailableConversation(thread, input, linked.threadId)) {
      throw new Error(
        "The linked conversation is unavailable. Choose an active conversation from the pull request workspace.",
      );
    }
    return {
      environmentId: linked.environmentId,
      projectId: linked.projectId,
      threadId: linked.threadId,
    };
  }
  const draft = linked.draftId
    ? (dependencies.composer ?? useComposerDraftStore.getState()).getDraftSession(linked.draftId)
    : null;
  if (
    draft?.environmentId === input.environmentId &&
    draft.projectId === input.projectId &&
    draft.threadId === linked.threadId
  ) {
    return linked;
  }
  throw new Error(
    "The linked conversation is unavailable. Choose a conversation from the pull request workspace.",
  );
}

/** Destination selection stays outside durable PR state until this succeeds. */
async function preparePullRequestHandoffOnce(
  input: PullRequestHandoffInput,
  destination: PullRequestDraftDestination,
  dependencies: HandoffDependencies,
): Promise<PullRequestLinkedTarget> {
  const composer = dependencies.composer ?? useComposerDraftStore.getState();
  const getWorkspaces = dependencies.getWorkspaces ?? usePullRequestWorkspaceStore.getState;
  const scope = workspaceScope(input);
  const key = pullRequestWorkspaceKey(scope);
  let target: PullRequestLinkedTarget;
  if (destination.kind === "existing") {
    const thread = dependencies.readThread(
      scopeThreadRef(input.environmentId, destination.threadId),
    );
    if (!isAvailableConversation(thread, input, destination.threadId)) {
      throw new Error(
        "The selected conversation is unavailable. Choose an active conversation in this project.",
      );
    }
    target = {
      environmentId: input.environmentId,
      projectId: input.projectId,
      threadId: destination.threadId,
    };
  } else {
    const threadId = newThreadId();
    const prepared = await dependencies.prepare(threadId);
    const draftId = newDraftId();
    // Dedicated identity keeps prior PR drafts and unrelated project drafts intact.
    composer.setLogicalProjectDraftThreadId(
      `pull-request:${key}:${draftId}`,
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
    target = { environmentId: input.environmentId, projectId: input.projectId, threadId, draftId };
  }
  appendPullRequestHandoffContext(
    target.draftId ?? scopeThreadRef(target.environmentId, target.threadId),
    buildPullRequestHandoffContext(
      input.pullRequest,
      getWorkspaces().entriesByKey[key] ?? EMPTY_PULL_REQUEST_WORKSPACE,
    ),
    composer,
  );
  getWorkspaces().link(scope, target);
  return target;
}

const pendingHandoffs = new Map<
  string,
  { destination: string; operation: Promise<PullRequestLinkedTarget> }
>();

export function preparePullRequestHandoff(
  input: PullRequestHandoffInput,
  destination: PullRequestDraftDestination,
  dependencies: HandoffDependencies,
): Promise<PullRequestLinkedTarget> {
  const key = pullRequestWorkspaceKey(workspaceScope(input));
  const destinationKey = destination.kind === "new" ? "new" : `existing:${destination.threadId}`;
  const pending = pendingHandoffs.get(key);
  if (pending) {
    return pending.destination === destinationKey
      ? pending.operation
      : Promise.reject(new Error("A draft is already being prepared for this pull request."));
  }
  const operation = preparePullRequestHandoffOnce(input, destination, dependencies).finally(() => {
    pendingHandoffs.delete(key);
  });
  pendingHandoffs.set(key, { destination: destinationKey, operation });
  return operation;
}

export function usePullRequestHandoff(input: PullRequestHandoffInput) {
  const navigate = useNavigate();
  const workspaceKey = pullRequestWorkspaceKey(workspaceScope(input));
  const prepareAction = usePreparePullRequestThreadAction({
    environmentId: input.environmentId,
    cwd: input.cwd,
  });
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openTarget = useCallback(
    async (resolve: () => PullRequestLinkedTarget | Promise<PullRequestLinkedTarget>) => {
      if (pending.current) return;
      pending.current = true;
      setIsPending(true);
      setError(null);
      try {
        const target = await resolve();
        const ref = scopeThreadRef(target.environmentId, target.threadId);
        useRightPanelStore.getState().openPullRequest(ref, workspaceKey);
        if (target.draftId) {
          await navigate({ to: "/draft/$draftId", params: { draftId: target.draftId } });
        } else {
          await navigate({ to: "/$environmentId/$threadId", params: ref });
        }
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not open the pull request conversation.",
        );
      } finally {
        pending.current = false;
        setIsPending(false);
      }
    },
    [navigate, workspaceKey],
  );
  const prepareDraft = useCallback(
    (destination: PullRequestDraftDestination) =>
      openTarget(() =>
        preparePullRequestHandoff(input, destination, {
          prepare: async (threadId) => {
            const result = await prepareAction.run({
              reference: input.pullRequest.url,
              mode: "worktree",
              threadId,
            });
            if (result._tag === "Failure") {
              const cause = squashAtomCommandFailure(result);
              throw cause instanceof Error
                ? cause
                : new Error(
                    "Could not prepare the pull request worktree. Your notes and instructions are saved.",
                  );
            }
            return result.value;
          },
          readThread: readThreadShell,
        }),
      ),
    [input, openTarget, prepareAction],
  );
  const openLinkedConversation = useCallback(
    () => openTarget(() => resolveLinkedPullRequestTarget(input, { readThread: readThreadShell })),
    [input, openTarget],
  );
  return { prepareDraft, openLinkedConversation, isPending, error };
}
