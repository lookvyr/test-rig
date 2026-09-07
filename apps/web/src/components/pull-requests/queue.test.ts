import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, type GitPullRequestSummary } from "@t3tools/contracts";
import { buildPullRequestGroups } from "./queue";

const projects = ["First", "Second", "Third"].map((title) => ({
  id: ProjectId.make(title),
  environmentId: EnvironmentId.make("local"),
  title,
  workspaceRoot: `/repo/${title}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}));

function pr(number: number, title = "Fix UI"): GitPullRequestSummary {
  return {
    number,
    title,
    url: `https://github.com/owner/repo/pull/${number}`,
    author: "contributor",
    state: "open",
    isDraft: false,
    headRefName: "fix",
    baseRefName: "main",
    headSha: "head",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    labels: [],
  };
}
const query = (pullRequests: GitPullRequestSummary[]) => ({
  data: { repository: "owner/repo", pullRequests, truncated: false },
  isPending: false,
  error: null,
  refresh: () => {},
});

describe("PR shortcut ordering", () => {
  it("numbers rows continuously across projects, including more than nine results", () => {
    const groups = buildPullRequestGroups(
      projects,
      [
        query([pr(30), pr(2)]),
        query([]),
        query(Array.from({ length: 10 }, (_, index) => pr(index + 40))),
      ],
      "",
    );
    expect(groups.map((group) => group.startIndex)).toEqual([0, 2, 2]);
    expect(
      groups
        .flatMap((group) => group.items)
        .slice(0, 9)
        .map((item) => item.number),
    ).toEqual([30, 2, 40, 41, 42, 43, 44, 45, 46]);
  });

  it("renumbers exactly the matching rows after filtering", () => {
    const groups = buildPullRequestGroups(
      projects,
      [
        query([pr(1, "Fix UI"), pr(2, "Fix server")]),
        query([pr(3, "Fix server"), pr(4, "Fix UI")]),
        query([]),
      ],
      "  UI  ",
    );
    expect(groups.map((group) => group.startIndex)).toEqual([0, 1, 2]);
    expect(groups.flatMap((group) => group.items).map((item) => item.number)).toEqual([1, 4]);
  });

  it("uses displayed cached rows during refresh and fills earlier projects in place", () => {
    const pending = { data: null, isPending: true, error: null, refresh: () => {} };
    const cached = { ...query([pr(5)]), isPending: true };
    expect(
      buildPullRequestGroups(projects, [pending, cached, query([])], "").map(
        (group) => group.startIndex,
      ),
    ).toEqual([0, 0, 1]);
    expect(
      buildPullRequestGroups(projects, [query([pr(1), pr(2)]), cached, query([])], "").map(
        (group) => group.startIndex,
      ),
    ).toEqual([0, 2, 3]);
  });
});
