import { useEffect, useState } from "react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type DraftId, type DraftThreadState, useComposerDraftStore } from "../composerDraftStore";
import { gitEnvironment } from "../state/git";
import { useAtomCommand } from "../state/use-atom-command";

// A route remount can join the same preparation instead of creating another worktree request.
const preparations = new Map<DraftId, Promise<void>>();
export function preparePullRequestDraft(
  draftId: DraftId,
  prepare: (threadId: ThreadId) => Promise<{ branch: string; worktreePath: string | null }>,
): Promise<void> {
  const running = preparations.get(draftId);
  if (running) return running;
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  if (!draft?.pullRequestReference) return Promise.resolve();
  const operation = (async () => {
    const prepared = await prepare(draft.threadId);
    if (!prepared.worktreePath) throw new Error("The PR worktree could not be prepared.");
    const store = useComposerDraftStore.getState();
    const current = store.getDraftSession(draftId);
    if (
      current?.threadId !== draft.threadId ||
      current.environmentId !== draft.environmentId ||
      current.projectId !== draft.projectId ||
      current.pullRequestReference !== draft.pullRequestReference
    )
      return;
    store.setDraftThreadContext(draftId, {
      branch: prepared.branch,
      worktreePath: prepared.worktreePath,
      envMode: "worktree",
      startFromOrigin: false,
      pullRequestReference: null,
    });
  })().finally(() => preparations.delete(draftId));
  preparations.set(draftId, operation);
  return operation;
}

export function usePullRequestDraftWorkspace(
  draftId: DraftId | null,
  draft: DraftThreadState | null,
  project: EnvironmentProject | null,
  connected: boolean,
) {
  const prepare = useAtomCommand(gitEnvironment.preparePullRequestThread, { reportFailure: false });
  const reference = draft?.pullRequestReference;
  const environmentId = draft?.environmentId;
  const cwd = project?.workspaceRoot;
  const [failure, setFailure] = useState<{
    draftId: DraftId;
    attempt: number;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!draftId || !reference || !environmentId || !cwd || !connected) return;
    let cancelled = false;
    void preparePullRequestDraft(draftId, async (threadId) => {
      const result = await prepare({
        environmentId,
        input: { cwd, reference, mode: "worktree", threadId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    }).catch((cause) => {
      if (!cancelled)
        setFailure({
          draftId,
          attempt,
          message:
            cause instanceof Error ? cause.message : "Could not prepare the review worktree.",
        });
    });
    return () => {
      cancelled = true;
    };
  }, [draftId, reference, environmentId, cwd, connected, prepare, attempt]);
  return {
    error: failure?.draftId === draftId && failure.attempt === attempt ? failure.message : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
