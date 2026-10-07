import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2TurnItem,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useThread } from "~/state/entities";

/** Settled tools and captured checkpoints are receipts that workspace files may have changed. */
export function deriveWorkspaceMutationId(
  items: readonly { readonly item: Pick<OrchestrationV2TurnItem, "id" | "type" | "status"> }[],
  checkpoints: readonly Pick<OrchestrationV2Checkpoint, "id" | "status">[],
): string | null {
  let count = 0;
  let hash = 2_166_136_261;
  const include = (receipt: string) => {
    count += 1;
    for (let index = 0; index < receipt.length; index += 1) {
      hash = Math.imul(hash ^ receipt.charCodeAt(index), 16_777_619);
    }
  };
  // Parallel tools can finish out of transcript order. Fingerprint every settled
  // receipt so an earlier tool completing after a later one still invalidates.
  for (const { item } of items) {
    if (
      (item.type === "file_change" || item.type === "command_execution") &&
      item.status !== "pending" &&
      item.status !== "running" &&
      item.status !== "waiting"
    ) {
      include(`tool\0${item.id}\0${item.status}\0`);
    }
  }
  for (const checkpoint of checkpoints) {
    if (checkpoint.status === "ready") include(`checkpoint\0${checkpoint.id}\0`);
  }
  return count > 0 ? `${count}:${(hash >>> 0).toString(36)}` : null;
}

export function useThreadWorkspaceMutationId(threadRef: ScopedThreadRef | null) {
  const projection = useThread(threadRef, { waitForShell: true })?.projection;
  return useMemo(
    () =>
      deriveWorkspaceMutationId(projection?.visibleTurnItems ?? [], projection?.checkpoints ?? []),
    [projection?.visibleTurnItems, projection?.checkpoints],
  );
}
