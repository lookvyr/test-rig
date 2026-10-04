import { useCallback, useMemo, useState } from "react";
import type { RuntimeRequestId } from "@t3tools/contracts";
import type { Thread, SessionPhase } from "../../types";
import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  type LocalDispatchSnapshot,
} from "../ChatView.logic";

export function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestRun: Thread["latestRun"] | null;
  phase: SessionPhase;
  activePendingApproval: RuntimeRequestId | null;
  activePendingUserInput: RuntimeRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);
  const latestUserMessageId =
    input.activeThread?.projection?.messages.findLast((message) => message.role === "user")?.id ??
    null;

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestRun: input.activeLatestRun,
        latestUserMessageId,
        session: input.activeThread?.runtime ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        threadError: input.threadError,
      }),
    [
      input.activeLatestRun,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.runtime,
      input.phase,
      input.threadError,
      latestUserMessageId,
      localDispatch,
    ],
  );
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        const active = serverAcknowledgedLocalDispatch ? null : current;
        if (active) {
          return active.preparingWorktree === preparingWorktree
            ? active
            : { ...active, preparingWorktree };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread, serverAcknowledgedLocalDispatch],
  );

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
  };
}
