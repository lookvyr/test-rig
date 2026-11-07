import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { projectForPullRequest } from "./pull-requests/threadPullRequests";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useState } from "react";
import { create } from "zustand";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useProject, useProjects, useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { gitEnvironment } from "../state/git";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { parsePullRequestReference } from "../pullRequestReference";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";

const useLinkTarget = create<{ threadRef: ScopedThreadRef | null }>(() => ({ threadRef: null }));
export const openLinkThreadPullRequest = (threadRef: ScopedThreadRef) =>
  useLinkTarget.setState({ threadRef });
const close = () => useLinkTarget.setState({ threadRef: null });

export function LinkThreadPullRequestDialog() {
  const target = useLinkTarget((state) => state.threadRef);
  return target ? (
    <LinkDialog key={`${target.environmentId}:${target.threadId}`} threadRef={target} />
  ) : null;
}

function LinkDialog({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const projects = useProjects();
  const [reference, setReference] = useState("");
  const [debouncedReference] = useDebouncedValue(reference, { wait: 450 });
  const [saving, setSaving] = useState(false);
  const settings = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.sourceControlProviders,
  );
  const urlKey = parseChangeRequestUrl(debouncedReference);
  const targetProject = urlKey
    ? projectForPullRequest(projects, threadRef.environmentId, urlKey)
    : project;
  const cwd = targetProject?.workspaceRoot ?? null;
  const parsed = parsePullRequestReference(debouncedReference);
  const resolution = useEnvironmentQuery(
    cwd && parsed && settings.github
      ? gitEnvironment.pullRequestResolution({
          environmentId: threadRef.environmentId,
          input: { cwd, reference: parsed },
        })
      : null,
  );
  const pr = reference === debouncedReference ? resolution.data?.pullRequest : null;
  const repositoryError =
    urlKey && !targetProject
      ? "Add this GitHub repository as a project in this environment before linking its PRs."
      : null;
  const linkPullRequest = useAtomCommand(threadEnvironment.linkPullRequest);
  const link = async () => {
    if (!pr) return;
    const key = parseChangeRequestUrl(pr.url);
    if (!key) return;
    setSaving(true);
    const result = await linkPullRequest({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, ...key, url: pr.url, source: "manual" },
    });
    setSaving(false);
    if (result._tag === "Success") close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link PR to thread</DialogTitle>
          <DialogDescription>
            Add a pull request to {thread?.title ?? "this thread"}. Linking does not change the
            checked-out branch.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Input
            autoFocus
            aria-label="Pull request URL or number"
            placeholder="PR URL or number"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && pr && !saving) void link();
            }}
          />
          {pr ? (
            <p className="text-sm">
              #{pr.number} · {pr.title} <span className="text-muted-foreground">({pr.state})</span>
            </p>
          ) : reference.trim() ? (
            <p className="text-sm text-muted-foreground">
              {!settings.github
                ? "Enable this source control provider in Settings to link a PR."
                : (resolution.error ??
                  (resolution.isPending || reference !== debouncedReference
                    ? "Looking up pull request…"
                    : "Enter a valid PR URL or number."))}
            </p>
          ) : null}
          {repositoryError ? <p className="text-sm text-destructive">{repositoryError}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!pr || !settings.github || !!repositoryError || saving}
            onClick={() => void link()}
          >
            {saving ? "Linking…" : "Link PR"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
