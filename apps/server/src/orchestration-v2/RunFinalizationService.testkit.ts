import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";

export const runFinalizationDependenciesTestLayer = Layer.mergeAll(
  Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
  Layer.mock(PullRequestService.PullRequestService)({ refreshAfterTurn: () => Effect.void }),
  Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
    refreshLocalStatus: () =>
      Effect.succeed({
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      }),
  }),
);
