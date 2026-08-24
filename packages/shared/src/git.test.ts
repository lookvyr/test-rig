import type { VcsStatusRemoteResult, VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyGitStatusStreamEvent,
  buildGeneratedWorktreeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  normalizeGitRemoteUrl,
  parseTemporaryWorktreeBranchPrefix,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  LEGACY_WORKTREE_BRANCH_PREFIX,
} from "./git.ts";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:T3Tools/T3Code.git")).toBe(
      "github.com/t3tools/t3code",
    );
    expect(normalizeGitRemoteUrl("https://github.com/T3Tools/T3Code.git")).toBe(
      "github.com/t3tools/t3code",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/T3Tools/T3Code")).toBe(
      "github.com/t3tools/t3code",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:T3Tools/platform/T3Code.git")).toBe(
      "gitlab.com/t3tools/platform/t3code",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/T3Tools/platform/T3Code.git")).toBe(
      "gitlab.com/t3tools/platform/t3code",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("git@github.com:T3Tools/T3Code.git"),
    ).toBe("T3Tools/T3Code");
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("https://github.com/T3Tools/T3Code.git"),
    ).toBe("T3Tools/T3Code");
  });
});

describe("isTemporaryWorktreeBranch", () => {
  it("matches the generated temporary worktree refName format", () => {
    expect(
      isTemporaryWorktreeBranch(
        buildTemporaryWorktreeBranchName((byteLength) => {
          expect(byteLength).toBe(4);
          return "DEADBEEF";
        }, "test-rig"),
      ),
    ).toBe(true);
  });

  it("builds and parses a self-identifying temporary ref for a custom prefix", () => {
    const branch = buildTemporaryWorktreeBranchName(() => "DEADBEEF", "example/team");

    expect(branch).toBe("example/team/_worktree/deadbeef");
    expect(parseTemporaryWorktreeBranchPrefix(branch)).toBe("example/team");
    expect(isTemporaryWorktreeBranch(branch)).toBe(true);
  });

  it("uses the self-identifying form when the configured prefix is t3code", () => {
    expect(buildTemporaryWorktreeBranchName(() => "DEADBEEF", "t3code")).toBe(
      "t3code/_worktree/deadbeef",
    );
  });

  it("matches legacy temporary worktree refs", () => {
    expect(isTemporaryWorktreeBranch(`${LEGACY_WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${LEGACY_WORKTREE_BRANCH_PREFIX}/deadbeef `)).toBe(true);
    expect(isTemporaryWorktreeBranch(`${LEGACY_WORKTREE_BRANCH_PREFIX}/DEADBEEF`)).toBe(true);
  });

  it("normalizes a UUID-shaped random callback to the canonical 8-hex form", () => {
    expect(
      buildTemporaryWorktreeBranchName(() => "f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12", "test-rig"),
    ).toBe("test-rig/_worktree/f4ae4e0e");
  });

  it("matches legacy UUID-shaped temporary worktree refs from older mobile builds", () => {
    expect(
      isTemporaryWorktreeBranch(
        `${LEGACY_WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12`,
      ),
    ).toBe(true);
  });

  it("rejects UUID-shaped refs that are not RFC 4122 v4", () => {
    // version nibble is not 4
    expect(
      isTemporaryWorktreeBranch(
        `${LEGACY_WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-1d48-b4f2-9cf0aa54ab12`,
      ),
    ).toBe(false);
    // variant nibble is not [89ab]
    expect(
      isTemporaryWorktreeBranch(
        `${LEGACY_WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-c4f2-9cf0aa54ab12`,
      ),
    ).toBe(false);
  });

  it("rejects non-temporary refName names", () => {
    expect(isTemporaryWorktreeBranch(`${LEGACY_WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("main")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${LEGACY_WORKTREE_BRANCH_PREFIX}/deadbeef-extra`)).toBe(
      false,
    );
    expect(isTemporaryWorktreeBranch("feature/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/_worktree/not-hex")).toBe(false);
    expect(isTemporaryWorktreeBranch("Release Candidate/_worktree/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("Release.v1/_worktree/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("UPPERCASE/_worktree/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("/leading/_worktree/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch("double//slash/_worktree/deadbeef")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${"a".repeat(65)}/_worktree/deadbeef`)).toBe(false);
  });

  it("trims surrounding whitespace around a valid temporary ref", () => {
    expect(parseTemporaryWorktreeBranchPrefix(" example/team/_worktree/deadbeef ")).toBe(
      "example/team",
    );
  });

  it("builds a generated branch with the prefix captured by the temporary ref", () => {
    const prefix = parseTemporaryWorktreeBranchPrefix("example/team/_worktree/deadbeef");

    expect(prefix).toBe("example/team");
    expect(buildGeneratedWorktreeBranchName("feature/Fix reconnect backoff", prefix!)).toBe(
      "example/team/feature/fix-reconnect-backoff",
    );
  });

  it("does not duplicate the selected prefix returned by text generation", () => {
    expect(buildGeneratedWorktreeBranchName("example/team/fix-reconnect", "example/team")).toBe(
      "example/team/fix-reconnect",
    );
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: VcsStatusResult = {
      isRepo: true,
      sourceControlProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
