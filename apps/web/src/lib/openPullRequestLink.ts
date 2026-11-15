import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { type LocalApi, repositoryGroupingKeyOf } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { type MouseEvent, useCallback } from "react";

import { usePullRequestQueueStore } from "../components/pull-requests/workspaceStore";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "../hooks/useSettings";
import { readLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects } from "../state/entities";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentServerConfigsAtom } from "../state/server";

export class PullRequestLinkOpenError extends Schema.TaggedError<PullRequestLinkOpenError>()(
  "PullRequestLinkOpenError",
  {
    targetOrigin: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(targetUrl: string, cause: unknown): PullRequestLinkOpenError {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      // Keep malformed URLs out of diagnostics while preserving the open failure below.
    }
    return new PullRequestLinkOpenError({ targetOrigin, cause });
  }

  override get message(): string {
    return this.targetOrigin === null
      ? "Unable to open pull request link."
      : `Unable to open pull request link at ${this.targetOrigin}.`;
  }
}

export async function openPullRequestLink(
  shell: Pick<LocalApi["shell"], "openExternal">,
  targetUrl: string,
): Promise<void> {
  try {
    await shell.openExternal(targetUrl);
  } catch (cause) {
    throw PullRequestLinkOpenError.fromCause(targetUrl, cause);
  }
}

/**
 * The saved GitHub project a pull request URL belongs to, if any. Only these open in the app's
 * pull requests page; anything else still opens on the host.
 */
export function projectForPullRequestUrl(
  projects: ReadonlyArray<EnvironmentProject>,
  url: string,
): { readonly project: EnvironmentProject; readonly canonicalUrl: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  if (!match) return null;
  const repositoryKey = `${parsed.host}/${match[1]}/${match[2]}`.toLowerCase();
  const project = projects.find(
    (candidate) =>
      candidate.repositoryIdentity?.provider === "github" &&
      repositoryGroupingKeyOf(candidate.repositoryIdentity).toLowerCase() === repositoryKey,
  );
  // The queue keys pull requests by their plain URL, so /files and #comment links match it.
  return project
    ? { project, canonicalUrl: `https://${parsed.host}/${match[1]}/${match[2]}/pull/${match[3]}` }
    : null;
}

/** Projects whose environment is loaded with GitHub on, primary environment first. */
function pullRequestCapableProjects(): ReadonlyArray<EnvironmentProject> {
  const configs = appAtomRegistry.get(environmentServerConfigsAtom);
  const primaryEnvironmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  return readProjects()
    .filter(
      (project) =>
        configs.get(project.environmentId)?.settings.sourceControlProviders.github === true,
    )
    .toSorted(
      (left, right) =>
        Number(right.environmentId === primaryEnvironmentId) -
        Number(left.environmentId === primaryEnvironmentId),
    );
}

/**
 * Returns a click handler that opens a pull request URL: in the app's pull requests page when
 * "Open pull requests in Test Rig" is on and the repository is a saved project, otherwise in the
 * system browser. Cmd/Ctrl-click or a middle click always opens the host.
 *
 * Stops event propagation/default so activating the link does not also trigger
 * an enclosing row or trigger (e.g. opening the branch dropdown), and surfaces a
 * toast when the local API is unavailable or the open fails.
 */
export function useOpenPrLink() {
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const navigate = useNavigate();
  const select = usePullRequestQueueStore((state) => state.select);
  return useCallback(
    (event: MouseEvent<HTMLElement>, prUrl: string, options?: { readonly external?: boolean }) => {
      event.preventDefault();
      event.stopPropagation();

      const forceExternal =
        options?.external === true || event.metaKey || event.ctrlKey || event.button === 1;
      const match =
        openInApp && !forceExternal
          ? projectForPullRequestUrl(pullRequestCapableProjects(), prUrl)
          : null;
      if (match) {
        const { project } = match;
        select({
          environmentId: project.environmentId,
          projectId: project.id,
          projectName: project.title,
          cwd: project.workspaceRoot,
          reference: match.canonicalUrl,
        });
        void navigate({ to: "/pull-requests" });
        return;
      }

      const api = readLocalApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Link opening is unavailable.",
        });
        return;
      }

      void openPullRequestLink(api.shell, prUrl).catch((error) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open pull request link",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [navigate, openInApp, select],
  );
}
