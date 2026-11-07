import { pullRequestHostOf } from "@t3tools/contracts";
import type { RepositoryIdentity } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { getChangeRequestTerminology } from "@t3tools/shared/sourceControl";

export const capitalizeTerm = (term: string) => term.charAt(0).toUpperCase() + term.slice(1);
const changeRequest = { ...getChangeRequestTerminology(null), plural: "pull requests" };
export type ChangeRequestTerminology = typeof changeRequest;
const github = {
  kind: "github" as const,
  label: "GitHub",
  changeRequest,
  reviewSummaryRequired: () => false,
  authorProfileUrl: (login: string, url: string) =>
    login.endsWith("[bot]") ? null : `${new URL(url).origin}/${encodeURIComponent(login)}`,
  checkoutCommand: ({
    number,
  }: {
    number: number;
    headBranch?: string | undefined;
    headRepositoryNameWithOwner?: string | null | undefined;
    repositoryUrl?: string | null | undefined;
  }) => `gh pr checkout ${number}`,
  checkoutChangeRequestHost: (identity: RepositoryIdentity) =>
    pullRequestHostOf(identity, "github"),
};
function parse(url: string) {
  const key = parseChangeRequestUrl(url);
  return key
    ? { link: { ...key, repositoryUrl: `${new URL(url).origin}/${key.repository}` } }
    : null;
}
/** Presentation for the fork's only executable hosting integration. */
export const sourceControlClients = {
  definitions: [github],
  get: (_kind: string | undefined) => github,
  find: (kind: string) => (kind === "github" ? github : undefined),
  findByPublicHost: (host: string) => (host === "github.com" ? github : undefined),
  findByChangeRequestUrl: (url: string) => (parse(url) ? github : undefined),
  parseChangeRequestUrl: parse,
  changeRequestHost: (identity: RepositoryIdentity, _kind: string) =>
    pullRequestHostOf(identity, "github"),
  hostLabelForChangeRequestUrl: (_url: string) => "GitHub",
};
