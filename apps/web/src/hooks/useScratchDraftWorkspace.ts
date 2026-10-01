import { useEffect, useState } from "react";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { type DraftId, type DraftThreadState, useComposerDraftStore } from "../composerDraftStore";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";

/** Keep workspace actions unavailable until the server has prepared the draft folder. */
export function useScratchDraftWorkspace(
  draftId: DraftId | null,
  draft: DraftThreadState | null,
  project: EnvironmentProject | null,
  scratchWorkspaceRoot: string | undefined,
  configReady: boolean,
  terminalsReady: boolean,
  hasTerminals: boolean,
) {
  const ensureScratch = useAtomCommand(projectEnvironment.ensureScratch, { reportFailure: false });
  const needsWorkspace = Boolean(
    draft &&
    project &&
    isScratchProject(project, scratchWorkspaceRoot) &&
    draft.worktreePath === null,
  );
  const pending = Boolean(draft && (!configReady || needsWorkspace));
  const blockedByTerminals = needsWorkspace && hasTerminals;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const threadId = draft?.threadId;
  const environmentId = project?.environmentId;
  const projectId = project?.id;

  useEffect(() => {
    if (
      !needsWorkspace ||
      !terminalsReady ||
      hasTerminals ||
      !draftId ||
      !threadId ||
      !environmentId ||
      !projectId
    )
      return;
    let cancelled = false;
    setError(null);
    void (async () => {
      const result = await ensureScratch({ environmentId, input: { threadId } });
      if (cancelled) return;
      if (result._tag === "Failure") {
        setError(String(squashAtomCommandFailure(result)));
        return;
      }
      if (!result.value.worktreePath || result.value.projectId !== projectId) {
        setError("The draft workspace could not be prepared.");
        return;
      }
      const store = useComposerDraftStore.getState();
      const current = store.getDraftSession(draftId);
      if (
        current?.threadId === threadId &&
        current.environmentId === environmentId &&
        current.projectId === projectId
      ) {
        store.setDraftThreadContext(draftId, { worktreePath: result.value.worktreePath });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    needsWorkspace,
    terminalsReady,
    hasTerminals,
    draftId,
    threadId,
    environmentId,
    projectId,
    ensureScratch,
    attempt,
  ]);

  return { pending, blockedByTerminals, error, retry: () => setAttempt((value) => value + 1) };
}
