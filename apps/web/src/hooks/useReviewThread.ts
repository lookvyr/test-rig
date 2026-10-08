import { useMemo } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { buildLocalDraftThread } from "../components/ChatView.logic";
import { NO_PROVIDER_MODEL_SELECTION } from "../providerInstances";
import { useThread } from "../state/entities";

/** Git review is available before a draft has a server conversation. */
export function useReviewThread(ref: ScopedThreadRef | null, target: ScopedThreadRef | DraftId) {
  const draft = useComposerDraftStore((store) =>
    ref
      ? store.getDraftThreadByRef(ref)
      : typeof target === "string"
        ? store.getDraftSession(target)
        : store.getDraftThreadByRef(target),
  );
  const threadRef = ref ?? (draft ? scopeThreadRef(draft.environmentId, draft.threadId) : null);
  const serverThread = useThread(threadRef, { waitForShell: draft !== null });
  const localThread = useMemo(
    () =>
      draft ? buildLocalDraftThread(draft.threadId, draft, NO_PROVIDER_MODEL_SELECTION) : null,
    [draft],
  );
  return { threadRef, thread: serverThread ?? localThread };
}
