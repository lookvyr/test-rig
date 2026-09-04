import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { useThreadShell } from "~/state/entities";

/** Refresh mounted workspace views once the active thread finishes editing. */
export function useOnTurnCompleted(threadRef: ScopedThreadRef | null, refresh: () => void) {
  const thread = useThreadShell(threadRef);
  const scope = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const completedAt = thread?.latestTurn?.completedAt ?? null;
  const previous = useRef<{ scope: string | null; completedAt: string | null } | null>(null);
  const onCompleted = useEffectEvent(refresh);

  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, completedAt };
    if (last?.scope === scope && completedAt !== null && completedAt !== last.completedAt) {
      onCompleted();
    }
  }, [scope, completedAt]);
}
