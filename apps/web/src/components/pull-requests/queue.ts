import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { GitListPullRequestsInput, GitListPullRequestsResult } from "@t3tools/contracts";
import type { EnvironmentQueryView } from "../../state/query";

/** A number searches each project. A full URL restricts the read to its saved repository. */
export function pullRequestQueueLookup(text: string): GitListPullRequestsInput["lookup"] {
  const term = text.trim();
  const direct = /^#?(\d+)$/.exec(term);
  let digits = direct?.[1];
  let repository: string | undefined;
  if (!digits) {
    if (!/^https?:\/\//i.test(term)) return;
    try {
      const url = new URL(term);
      const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/|$)/.exec(url.pathname);
      if (!match) return;
      digits = match[2];
      repository = `https://${url.host}/${match[1]}`.toLowerCase();
    } catch {
      return;
    }
  }
  const number = Number(digits);
  if (Number.isSafeInteger(number) && number > 0)
    return { number, ...(repository ? { repository } : {}) };
}

/** Rows and keyboard positions share the same filtered, project-ordered results. */
export function buildPullRequestGroups(
  projects: readonly EnvironmentProject[],
  queries: ReadonlyArray<EnvironmentQueryView<GitListPullRequestsResult>>,
  searchText: string,
) {
  const search = searchText.trim().toLowerCase();
  const lookup = pullRequestQueueLookup(search);
  let nextIndex = 0;
  return projects.map((project, index) => {
    const query = queries[index]!;
    const items =
      query.data?.pullRequests.filter((pr) =>
        lookup
          ? pr.number === lookup.number &&
            (!lookup.repository || lookup.repository === query.data?.repository.toLowerCase())
          : `${pr.title} #${pr.number} ${pr.author} ${pr.url} ${query.data?.repository} ${project.title}`
              .toLowerCase()
              .includes(search),
      ) ?? [];
    const startIndex = nextIndex;
    nextIndex += items.length;
    return { project, query, items, startIndex };
  });
}
