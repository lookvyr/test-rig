import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { PullRequestSelection } from "./workspaceStore";

/** Persisted PR selections must still belong to the exact environment and project folder. */
export function isPullRequestSelectionAvailable(
  selection: PullRequestSelection | null,
  projects: ReadonlyArray<{ environmentId: EnvironmentId; id: ProjectId; workspaceRoot: string }>,
): boolean {
  return (
    selection !== null &&
    projects.some(
      (project) =>
        project.environmentId === selection.environmentId &&
        project.id === selection.projectId &&
        project.workspaceRoot === selection.cwd,
    )
  );
}
