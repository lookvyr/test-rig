import type { PullRequestDetail } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { isPullRequestActionAvailable } from "./pullRequestDetail.logic";

const open = {
  state: "open",
  isDraft: false,
  autoMergeEnabled: false,
  mergeability: "mergeable",
  baseComparison: "up-to-date",
  workflowApprovalsRequired: 0,
} as const satisfies Partial<PullRequestDetail>;

describe("PR management actions", () => {
  it("withholds single-PR merge operations when the stack owns them, rules conflict, or all methods are disabled", () => {
    for (const action of ["merge", "enable-auto-merge"] as const) {
      expect(isPullRequestActionAvailable(action, open, true, true)).toBe(true);
      expect(isPullRequestActionAvailable(action, open, false, true)).toBe(false);
      expect(
        isPullRequestActionAvailable(action, { ...open, mergeability: "conflicting" }, true, true),
      ).toBe(false);
      expect(isPullRequestActionAvailable(action, open, true, false)).toBe(false);
    }
  });
  it("offers approval only when GitHub reports waiting fork workflows on an open PR", () => {
    expect(isPullRequestActionAvailable("approve-workflows", open, true, true)).toBe(false);
    const waiting = { ...open, workflowApprovalsRequired: 2 };
    expect(isPullRequestActionAvailable("approve-workflows", waiting, true, true)).toBe(true);
    expect(
      isPullRequestActionAvailable(
        "approve-workflows",
        { ...waiting, state: "closed" },
        true,
        true,
      ),
    ).toBe(false);
  });
});
