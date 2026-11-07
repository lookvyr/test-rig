import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { projectForPullRequest } from "./threadPullRequests";

const environmentId = EnvironmentId.make("local");
function project(name: string, origin?: string): EnvironmentProject {
  return {
    id: ProjectId.make(name),
    environmentId,
    title: name,
    workspaceRoot: `/${name}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
    repositoryIdentity: {
      canonicalKey: "github.com/upstream/repo",
      provider: "github",
      locator: {
        source: "git-remote",
        remoteName: origin ? "upstream" : "origin",
        remoteUrl: "https://github.com/upstream/repo.git",
      },
      ...(origin ? { origin: { canonicalKey: origin } } : {}),
    },
  };
}
describe("projectForPullRequest", () => {
  it("routes by the repository read by the PR workspace rather than a fork's upstream", () => {
    const fork = project("fork", "github.com/owner/fork");
    const upstream = project("upstream");
    const key = { host: "GitHub.com", repository: "Upstream/Repo", number: 1 };
    expect(projectForPullRequest([fork, upstream], environmentId, key)).toBe(upstream);
    expect(projectForPullRequest([fork], environmentId, key)).toBeUndefined();
    expect(projectForPullRequest([fork], environmentId, { ...key, repository: "owner/fork" })).toBe(
      fork,
    );
    expect(projectForPullRequest([upstream], EnvironmentId.make("remote"), key)).toBeUndefined();
  });
});
