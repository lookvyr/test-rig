import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { isPullRequestSelectionAvailable } from "./selection";

const selection = {
  environmentId: EnvironmentId.make("env-a"),
  projectId: ProjectId.make("project-a"),
  projectName: "Example",
  cwd: "/repo",
  reference: "https://github.com/example/repo/pull/1",
};
const project = {
  environmentId: selection.environmentId,
  id: selection.projectId,
  workspaceRoot: selection.cwd,
};

describe("persisted pull request selection", () => {
  it("accepts the current project and exact folder", () => {
    expect(isPullRequestSelectionAvailable(selection, [project])).toBe(true);
  });
  it("rejects removed projects, moved folders, and projects in another environment", () => {
    expect(isPullRequestSelectionAvailable(selection, [])).toBe(false);
    expect(
      isPullRequestSelectionAvailable(selection, [{ ...project, workspaceRoot: "/moved" }]),
    ).toBe(false);
    expect(
      isPullRequestSelectionAvailable(selection, [
        { ...project, environmentId: EnvironmentId.make("env-b") },
      ]),
    ).toBe(false);
  });
});
