import type { OrchestrationThreadShell } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type Status = NonNullable<OrchestrationThreadShell["worktreeCleanup"]>;

/** Recomputed from checkout state after restart; only changed statuses are published. */
export class WorktreeCleanupState extends Context.Service<
  WorktreeCleanupState,
  {
    readonly get: (id: string) => Status | null;
    readonly set: (id: string, status: Status | null) => boolean;
    readonly ids: () => string[];
  }
>()("t3/workspace/WorktreeCleanupState") {}

export const layer = Layer.effect(
  WorktreeCleanupState,
  Effect.sync(() => {
    const statuses = new Map<string, Status>();
    return WorktreeCleanupState.of({
      get: (id) => statuses.get(id) ?? null,
      ids: () => [...statuses.keys()],
      set: (id, status) => {
        const previous = statuses.get(id) ?? null;
        if (previous?.state === status?.state && previous?.reason === status?.reason) return false;
        if (status === null) statuses.delete(id);
        else statuses.set(id, status);
        return true;
      },
    });
  }),
);
