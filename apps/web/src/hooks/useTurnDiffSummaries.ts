import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import { useMemo } from "react";
import { inferCheckpointTurnCountByRunId } from "../session-logic";
import type { Thread, TurnDiffSummary } from "../types";

export function useTurnDiffSummaries(activeThread: Thread | null | undefined) {
  const turnDiffSummaries = useMemo<ReadonlyArray<TurnDiffSummary>>(() => {
    if (!activeThread) {
      return [];
    }
    return activeThread.projection ? deriveThreadCheckpointSummaries(activeThread.projection) : [];
  }, [activeThread]);

  const inferredCheckpointTurnCountByRunId = useMemo(
    () => inferCheckpointTurnCountByRunId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return { turnDiffSummaries, inferredCheckpointTurnCountByRunId };
}
