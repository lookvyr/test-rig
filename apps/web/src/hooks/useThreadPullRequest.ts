import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import type { ThreadPullRequestLink } from "@t3tools/contracts";
import type {
  EnvironmentId,
  SourceControlProviderSettings,
  ThreadPullRequestAssociation,
  VcsStatusResult,
} from "@t3tools/contracts";
import { useLeasedEnvironmentQuery } from "../state/query";
import { gitEnvironment } from "../state/git";
import { resolveEnabledThreadPr } from "../lib/threadPullRequest";
import { isSourceControlProviderEnabled } from "../sourceControlPresentation";

/** Explicit links read the PR in the project repository, independently of the current checkout. */
export function useThreadPullRequest(input: {
  pullRequests?: readonly ThreadPullRequestLink[] | undefined;
  pullRequestAutoLink?: boolean | undefined;
  environmentId: EnvironmentId;
  projectCwd: string | null;
  association?: ThreadPullRequestAssociation | null | undefined;
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
  providerSettings: SourceControlProviderSettings;
  enabled?: boolean;
}) {
  const association = input.association;
  const query = useLeasedEnvironmentQuery(
    association?.mode === "linked" &&
      input.projectCwd !== null &&
      isSourceControlProviderEnabled(input.providerSettings, association.provider)
      ? gitEnvironment.linkedPullRequest({
          environmentId: input.environmentId,
          input: { cwd: input.projectCwd, reference: association.reference },
        })
      : null,
    input.enabled ?? true,
  );
  const current = resolveThreadCurrentPullRequestLink(input.pullRequests ?? []);
  if (current && input.providerSettings.github) {
    return {
      number: current.number,
      title: current.snapshot?.title ?? current.repository,
      url: current.url,
      baseRef: current.snapshot?.baseBranch ?? "",
      headRef: current.snapshot?.headBranch ?? "",
      state: current.snapshot?.state ?? "open",
    };
  }
  if ((input.pullRequests?.length ?? 0) > 0 || input.pullRequestAutoLink === false) return null;
  const linked = query.data?.pullRequest;
  return resolveEnabledThreadPr({
    ...input,
    linkedPr: linked
      ? {
          number: linked.number,
          title: linked.title,
          url: linked.url,
          baseRef: linked.baseBranch,
          headRef: linked.headBranch,
          state: linked.state,
        }
      : null,
  });
}
