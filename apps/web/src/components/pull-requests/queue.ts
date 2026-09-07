import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { GitListPullRequestsResult } from "@t3tools/contracts";
import type { EnvironmentQueryView } from "../../state/query";

/** Rows and keyboard positions share the same filtered, project-ordered results. */
export function buildPullRequestGroups(
  projects: readonly EnvironmentProject[],
  queries: ReadonlyArray<EnvironmentQueryView<GitListPullRequestsResult>>,
  searchText: string,
) {
  const search = searchText.trim().toLowerCase();
  let nextIndex = 0;
  return projects.map((project, index) => {
    const query = queries[index]!;
    const items =
      query.data?.pullRequests.filter((pr) =>
        `${pr.title} #${pr.number} ${pr.author} ${pr.url} ${query.data?.repository} ${project.title}`
          .toLowerCase()
          .includes(search),
      ) ?? [];
    const startIndex = nextIndex;
    nextIndex += items.length;
    return { project, query, items, startIndex };
  });
}
