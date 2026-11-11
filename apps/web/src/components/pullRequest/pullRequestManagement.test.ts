import type { PullRequestDetail } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  isPullRequestActionAvailable,
  pullRequestMergeBlocker,
  resolvePullRequestPrimaryControl,
} from "./pullRequestDetail.logic";

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

describe("PR merge readiness", () => {
  const clean = { status: "ready", reason: "GitHub merge state: CLEAN" } as const;
  const unstable = {
    status: "ready",
    reason: "GitHub merge state: UNSTABLE; mergeable with non-passing checks",
  } as const;
  const blocked = { status: "blocked", reason: "GitHub merge state: BLOCKED" } as const;
  const base = {
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    checksState: "passing",
    mergeReadiness: clean,
    autoMergeEnabled: undefined,
    hasMergeMethod: true,
    canMerge: true,
    canMarkReady: true,
    canEnableAutoMerge: true,
  } as const;
  type PrimaryInput = Parameters<typeof resolvePullRequestPrimaryControl>[0];
  const primary = (overrides: Partial<PrimaryInput>) =>
    resolvePullRequestPrimaryControl({ ...base, ...overrides });

  it("enables Merge only when checks, reviews and the host all agree", () => {
    expect(primary({})).toBe("merge");
    expect(primary({ checksState: null })).toBe("merge");
    expect(primary({ approvalDecision: "approved" })).toBe("merge");
  });

  it("keeps Merge disabled, with a reason, while anything stands in the way", () => {
    const cases: ReadonlyArray<[Partial<PrimaryInput>, string]> = [
      [{ checksState: "failing", mergeReadiness: unstable }, "Checks are failing"],
      [{ checksState: "pending", mergeReadiness: unstable }, "Checks are still running"],
      [{ checksState: "failing", mergeReadiness: blocked }, "Checks are failing"],
      [{ approvalDecision: "changes-requested" }, "Changes were requested"],
      [
        { approvalDecision: "review-required", mergeReadiness: blocked },
        "Waiting on a required review",
      ],
      [
        { mergeReadiness: blocked, baseComparison: "behind" },
        "Branch is behind its base and needs updating",
      ],
      [{ mergeReadiness: blocked }, "Blocked by the repository's merge rules"],
      [
        { mergeability: "unknown", mergeReadiness: { status: "unknown", reason: "UNKNOWN" } },
        "Still checking whether this can merge",
      ],
      [
        { mergeReadiness: { status: "queued", reason: "GitHub merge state: CLEAN" } },
        "Already in the merge queue",
      ],
    ];
    for (const [overrides, reason] of cases) {
      expect(primary(overrides)).toBe("merge-not-ready");
      expect(pullRequestMergeBlocker({ ...base, ...overrides })).toBe(reason);
    }
  });

  it("still lets hosts without readiness merge when mergeability is unknown", () => {
    expect(primary({ mergeReadiness: undefined, mergeability: "unknown" })).toBe("merge");
  });

  it("offers auto-merge only where arming it would actually wait", () => {
    expect(
      primary({ autoMergeEnabled: false, checksState: "failing", mergeReadiness: blocked }),
    ).toBe("enable-auto-merge");
    // GitHub merges an UNSTABLE PR on the spot when auto-merge is armed.
    expect(
      primary({ autoMergeEnabled: false, checksState: "failing", mergeReadiness: unstable }),
    ).toBe("merge-not-ready");
    expect(
      primary({ autoMergeEnabled: false, checksState: "pending", mergeReadiness: undefined }),
    ).toBe("enable-auto-merge");
    expect(primary({ autoMergeEnabled: false })).toBe("merge");
  });

  it("leaves draft, conflict and permission handling as it was", () => {
    expect(primary({ isDraft: true, checksState: "failing" })).toBe("ready");
    expect(primary({ mergeability: "conflicting" })).toBe("resolve");
    expect(primary({ canMerge: false, checksState: "failing" })).toBeNull();
  });

  it("drops overflow-menu merges the host would refuse outright", () => {
    expect(
      isPullRequestActionAvailable("merge", { ...open, mergeReadiness: unstable }, true, true),
    ).toBe(true);
    expect(
      isPullRequestActionAvailable("merge", { ...open, mergeReadiness: blocked }, true, true),
    ).toBe(false);
    const queued = { status: "queued", reason: "GitHub merge state: CLEAN" } as const;
    expect(
      isPullRequestActionAvailable("merge", { ...open, mergeReadiness: queued }, true, true),
    ).toBe(false);
    expect(
      isPullRequestActionAvailable(
        "enable-auto-merge",
        { ...open, mergeReadiness: unstable },
        true,
        true,
      ),
    ).toBe(false);
    expect(
      isPullRequestActionAvailable(
        "enable-auto-merge",
        { ...open, mergeReadiness: blocked },
        true,
        true,
      ),
    ).toBe(true);
  });
});
