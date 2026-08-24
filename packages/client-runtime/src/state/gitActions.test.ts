import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveLiveThreadBranchUpdate } from "./gitActions.ts";

function status(refName: string): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName,
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  };
}

describe("resolveLiveThreadBranchUpdate temporary worktree refs", () => {
  it.each(["t3code/0a1b2c3d", "example/team/_worktree/0a1b2c3d"])(
    "does not regress semantic metadata to %s",
    (temporaryBranch) => {
      expect(
        resolveLiveThreadBranchUpdate({
          threadBranch: "example/team/fix-reconnect",
          gitStatus: status(temporaryBranch),
        }),
      ).toBeNull();
    },
  );
});
