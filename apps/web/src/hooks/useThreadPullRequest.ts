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
