import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useState } from "react";
import { create } from "zustand";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useProject, useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { gitEnvironment } from "../state/git";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  parsePullRequestReference,
  pullRequestReferenceProviderKind,
} from "../pullRequestReference";
import { isSourceControlProviderEnabled } from "../sourceControlPresentation";
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
  const cwd = project?.workspaceRoot ?? null;
  const [reference, setReference] = useState(
    thread?.pullRequestAssociation?.mode === "linked"
      ? thread.pullRequestAssociation.reference
      : "",
  );
  const [debouncedReference] = useDebouncedValue(reference, { wait: 450 });
  const [saving, setSaving] = useState(false);
  const settings = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.sourceControlProviders,
  );
  const status = useEnvironmentQuery(
    cwd ? vcsEnvironment.status({ environmentId: threadRef.environmentId, input: { cwd } }) : null,
  );
  const provider =
    pullRequestReferenceProviderKind(reference) ?? status.data?.sourceControlProvider?.kind;
  const enabled = isSourceControlProviderEnabled(settings, provider);
  const parsed = parsePullRequestReference(debouncedReference);
  const resolution = useEnvironmentQuery(
    cwd && parsed && enabled
      ? gitEnvironment.pullRequestResolution({
          environmentId: threadRef.environmentId,
          input: { cwd, reference: parsed },
        })
      : null,
  );
  const pr = reference === debouncedReference ? resolution.data?.pullRequest : null;
  // Resolve the number in this project too: a URL lookup can otherwise target another repository.
  const projectResolution = useEnvironmentQuery(
    cwd && pr && enabled
      ? gitEnvironment.pullRequestResolution({
          environmentId: threadRef.environmentId,
          input: { cwd, reference: String(pr.number) },
        })
      : null,
  );
  const belongsToProject = pr != null && projectResolution.data?.pullRequest.url === pr.url;
  const repositoryError =
    pr && !projectResolution.isPending && !belongsToProject
      ? "Choose a PR from this project's repository."
      : null;
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const link = async () => {
    if (!pr || !provider || !enabled || !belongsToProject) return;
    setSaving(true);
    const result = await updateMetadata({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        pullRequestAssociation: { mode: "linked", provider, reference: pr.url },
      },
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
            Choose a pull request for {thread?.title ?? "this thread"}. Linking does not change the
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
              {!enabled
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
          {thread?.pullRequestAssociation?.mode === "linked" ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const result = await updateMetadata({
                  environmentId: threadRef.environmentId,
                  input: {
                    threadId: threadRef.threadId,
                    pullRequestAssociation: { mode: "unlinked" },
                  },
                });
                setSaving(false);
                if (result._tag === "Success") close();
              }}
            >
              Unlink PR
            </Button>
          ) : null}
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!pr || !enabled || !belongsToProject || saving}
            onClick={() => void link()}
          >
            {saving ? "Linking…" : "Link PR"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
