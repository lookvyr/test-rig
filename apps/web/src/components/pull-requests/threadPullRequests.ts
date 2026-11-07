import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type ThreadPullRequestKey,
} from "@t3tools/contracts";

/** A PR is read through a saved project on the same environment. */
export function projectForPullRequest(
  projects: readonly EnvironmentProject[],
  environmentId: EnvironmentId,
  key: ThreadPullRequestKey,
) {
  const repositoryKey = `${key.host}/${key.repository}`.toLowerCase();
  return projects.find(
    (project) =>
      project.environmentId === environmentId &&
      project.repositoryIdentity?.provider === "github" &&
      repositoryGroupingKeyOf(project.repositoryIdentity).toLowerCase() === repositoryKey,
  );
}
