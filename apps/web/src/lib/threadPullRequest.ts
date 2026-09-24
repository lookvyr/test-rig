import type {
  SourceControlProviderSettings,
  ThreadPullRequestAssociation,
  VcsStatusResult,
} from "@t3tools/contracts";
import { isSourceControlProviderEnabled } from "../sourceControlPresentation";
type ThreadPr = VcsStatusResult["pr"];

export function resolveThreadPr(input: {
  association?: ThreadPullRequestAssociation | null | undefined;
  linkedPr?: ThreadPr | undefined;
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
}): ThreadPr | null {
  if (input.association?.mode === "unlinked") return null;
  if (input.association?.mode === "linked") return input.linkedPr ?? null;
  const { threadBranch, gitStatus } = input;
  if (gitStatus === null) {
    return null;
  }

  if (threadBranch === null || gitStatus.refName !== threadBranch) {
    return null;
  }

  return gitStatus.pr ?? null;
}

export function resolveEnabledThreadPr(input: {
  association?: ThreadPullRequestAssociation | null | undefined;
  linkedPr?: ThreadPr | undefined;
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
  providerSettings: SourceControlProviderSettings;
}): ThreadPr | null {
  const providerKind =
    input.association?.mode === "linked"
      ? input.association.provider
      : input.gitStatus?.sourceControlProvider?.kind;
  if (!isSourceControlProviderEnabled(input.providerSettings, providerKind)) {
    return null;
  }
  return resolveThreadPr(input);
}
