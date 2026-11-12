import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import {
  resolveThreadCurrentPullRequestLink,
  resolveThreadPullRequestChains,
  threadPullRequestAutoLinkEnabled,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { LegendList } from "@legendapp/list/react";
import {
  CheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LayersIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  UnlinkIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useProjects, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { openLinkThreadPullRequest } from "../LinkThreadPullRequestDialog";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { PullRequestInspector } from "./PullRequestInspector";
import { PullRequestSelect } from "./PullRequestSelect";
import { usePullRequestReviewStore } from "./reviewStore";
import { projectForPullRequest } from "./threadPullRequests";

const SOURCE_LABELS: Record<ThreadPullRequestLink["source"], string> = {
  manual: "Linked by you",
  branch: "Found on this branch",
  created: "Created from this thread",
  agent: "Linked by the agent",
  stack: "Found in the stack",
  "stack-dismissed": "Dismissed",
};

function PullRequestRow({
  link,
  depth,
  stackSize,
  selected,
  onSelect,
  onUnlink,
  onWatch,
  enabled,
}: {
  link: ThreadPullRequestLink;
  depth: number;
  stackSize: number;
  selected: boolean;
  onSelect: () => void;
  onUnlink: () => void;
  onWatch: () => void;
  enabled: boolean;
}) {
  const snapshot = link.snapshot;
  const open = !snapshot || snapshot.state === "open";
  const watching = link.watch !== undefined;
  const StateIcon =
    snapshot?.state === "merged"
      ? GitMergeIcon
      : snapshot?.state === "closed"
        ? GitPullRequestClosedIcon
        : snapshot?.isDraft
          ? GitPullRequestDraftIcon
          : GitPullRequestIcon;
  const tone =
    snapshot?.state === "merged"
      ? "text-violet-500"
      : snapshot?.state === "closed"
        ? "text-destructive"
        : snapshot?.isDraft || !snapshot
          ? "text-muted-foreground"
          : "text-success-foreground";
  return (
    <div
      className={cn(
        "group flex items-center rounded-md hover:bg-accent/50",
        selected && "bg-accent/40",
      )}
      style={{ marginLeft: depth ? Math.min(depth, 3) * 16 : 0 }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-2 p-2 text-left"
      >
        <StateIcon
          className={cn("mt-0.5 size-4 shrink-0", tone)}
          aria-label={snapshot ? (snapshot.isDraft && open ? "Draft" : snapshot.state) : "Syncing"}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs">
            <span
              title={`${SOURCE_LABELS[link.source]} · ${new Date(link.linkedAt).toLocaleString()}`}
              className="shrink-0 text-muted-foreground"
            >
              #{link.number}
            </span>
            <span className="truncate font-medium" title={snapshot?.title}>
              {snapshot?.title ?? "Loading pull request…"}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {stackSize > 1 && (
              <span
                className="inline-flex shrink-0 items-center gap-1"
                title={`${link.stack ? "GitHub" : "Branch"} stack of ${stackSize}`}
              >
                <LayersIcon className="size-3" />
                {stackSize}
              </span>
            )}
            {snapshot?.author && (
              <span className="max-w-24 shrink-0 truncate" title={snapshot.author.login}>
                {snapshot.author.login}
              </span>
            )}
            <span
              className="truncate font-mono"
              title={`${link.repository} · ${snapshot?.headBranch ?? ""} → ${snapshot?.baseBranch ?? ""}`}
            >
              {link.repository}
              {snapshot ? ` · ${snapshot.headBranch} → ${snapshot.baseBranch}` : ""}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className={cn("capitalize", tone)}>
              {snapshot ? (snapshot.isDraft && open ? "Draft" : snapshot.state) : "Syncing"}
            </span>
            {open && watching && (
              <span
                className="inline-flex shrink-0"
                title="Watching: the agent wakes when checks finish, someone comments, the branch conflicts, or approval or merge readiness changes"
              >
                <EyeIcon role="img" aria-label="Watching" className="size-3" />
              </span>
            )}
            {open && snapshot?.checksState && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  snapshot.checksState === "passing"
                    ? "text-success-foreground"
                    : snapshot.checksState === "failing"
                      ? "text-destructive"
                      : "text-warning-foreground",
                )}
              >
                <CircleDotIcon className="size-3" />
                Checks {snapshot.checksState}
              </span>
            )}
            {open && snapshot?.reviewDecision && (
              <span className="inline-flex items-center gap-1">
                {snapshot.reviewDecision === "approved" ? (
                  <CheckIcon className="size-3 text-success-foreground" />
                ) : (
                  <MessageSquareIcon className="size-3" />
                )}
                {snapshot.reviewDecision.replaceAll("-", " ")}
              </span>
            )}
            {snapshot?.mergeability === "conflicting" && open && (
              <span className="text-destructive">Conflicts</span>
            )}
            {snapshot?.additions !== undefined && (
              <span className="ml-auto font-mono text-success-foreground">
                +{snapshot.additions}{" "}
                <span className="text-destructive">−{snapshot.deletions ?? 0}</span>
              </span>
            )}
          </span>
        </span>
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Actions for PR #${link.number}`}
              className="mr-1"
            />
          }
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => void writeTextToClipboard(link.url, "PR link")}>
            <LinkIcon />
            Copy link
          </MenuItem>
          <MenuItem render={<a href={link.url} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon />
            Open in GitHub
          </MenuItem>
          {enabled && (open || watching) && (
            <MenuItem onClick={onWatch}>
              {watching ? <EyeOffIcon /> : <EyeIcon />}
              {watching ? "Stop watching" : "Watch for changes"}
            </MenuItem>
          )}
          <MenuItem onClick={onUnlink}>
            <UnlinkIcon />
            {link.source === "stack" ? "Dismiss from thread" : "Unlink from thread"}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

export function ThreadPullRequestsPanel({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const enabled = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.sourceControlProviders.github,
  );
  const links = visibleThreadPullRequests(thread?.pullRequests ?? []);
  const chains = resolveThreadPullRequestChains(links);
  const lines = chains.flatMap((chain) =>
    chain.layers.map((link, depth) => ({ link, depth, stackSize: chain.layers.length })),
  );
  const threadKey = scopedThreadKey(threadRef);
  const selectedUrl = usePullRequestReviewStore((state) => state.selectedByThread[threadKey]);
  const select = usePullRequestReviewStore((state) => state.select);
  const [showList, setShowList] = useState(true);
  const [unlinkedLayer, setUnlinkedLayer] = useState<{
    from: string;
    url: string;
    number: number;
  } | null>(null);
  const selected =
    links.find((link) => link.url === selectedUrl) ?? resolveThreadCurrentPullRequestLink(links);
  const project = selected
    ? projectForPullRequest(projects, threadRef.environmentId, selected)
    : null;
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest);
  const watch = useAtomCommand(threadEnvironment.watchPullRequest);
  const update = useAtomCommand(threadEnvironment.updateMetadata);
  const openCount = links.filter((link) => !link.snapshot || link.snapshot.state === "open").length;
  const lastSynced = links.reduce<string | null>(
    (latest, link) =>
      link.snapshot?.syncedAt && (!latest || link.snapshot.syncedAt > latest)
        ? link.snapshot.syncedAt
        : latest,
    null,
  );
  const linkInput = (link: ThreadPullRequestLink) => ({
    threadId: threadRef.threadId,
    host: link.host,
    repository: link.repository,
    number: link.number,
  });

  if (!showList && selected && enabled && project) {
    const layer = unlinkedLayer?.from === selected.url ? unlinkedLayer : null;
    const reference = layer?.url ?? selected.url;
    return (
      <section aria-label="Thread pull requests" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-3 py-2">
          <PullRequestSelect
            aria-label="Choose linked pull request"
            value={reference}
            onChange={(event) => {
              setUnlinkedLayer(null);
              select(threadKey, event.target.value);
            }}
            className="w-full"
          >
            {layer && <option value={layer.url}>#{layer.number} · Stack layer</option>}
            {links.map((link) => (
              <option key={link.url} value={link.url}>
                #{link.number} {link.snapshot?.title ?? link.repository}
              </option>
            ))}
          </PullRequestSelect>
        </div>
        <PullRequestInspector
          key={reference}
          onSelectStackLayer={(url, number) => {
            const linked = links.find((link) => link.url === url);
            if (linked) {
              setUnlinkedLayer(null);
              select(threadKey, linked.url);
            } else {
              setUnlinkedLayer({ from: selected.url, url, number });
            }
          }}
          selection={{
            environmentId: threadRef.environmentId,
            projectId: project.id,
            projectName: project.title,
            cwd: project.workspaceRoot,
            reference,
          }}
          threadRef={threadRef}
          onBack={() => setShowList(true)}
          onClose={onClose}
        />
      </section>
    );
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Thread pull requests">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <GitPullRequestIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Linked pull requests</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => openLinkThreadPullRequest(threadRef)}
        >
          <LinkIcon />
          Link PR
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close pull requests" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {links.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <LinkIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No linked pull requests</p>
          <p className="max-w-64 text-xs text-muted-foreground">
            Pull requests the agent opens from this thread appear here. Link one yourself from a URL
            or number.
          </p>
          <Button size="sm" variant="outline" onClick={() => openLinkThreadPullRequest(threadRef)}>
            Link pull request
          </Button>
        </div>
      ) : (
        <LegendList
          data={lines}
          keyExtractor={(line) => threadPullRequestKeyOf(line.link)}
          extraData={{ selectedUrl, enabled }}
          estimatedItemSize={84}
          className="min-h-0 flex-1 p-1.5"
          renderItem={({ item }) => (
            <PullRequestRow
              {...item}
              selected={selected?.url === item.link.url}
              enabled={enabled}
              onSelect={() => {
                setUnlinkedLayer(null);
                select(threadKey, item.link.url);
                setShowList(false);
              }}
              onUnlink={() =>
                void unlink({ environmentId: threadRef.environmentId, input: linkInput(item.link) })
              }
              onWatch={() =>
                void watch({
                  environmentId: threadRef.environmentId,
                  input: { ...linkInput(item.link), watching: item.link.watch === undefined },
                })
              }
            />
          )}
        />
      )}
      {!enabled && (
        <p className="p-3 text-xs text-muted-foreground">
          Enable GitHub in Settings to load PR details.
        </p>
      )}
      {!showList && selected && !project && (
        <p className="p-3 text-xs text-muted-foreground">
          Add {selected.repository} as a project in this environment to review this PR.
        </p>
      )}
      <footer className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <p title={lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString()}` : undefined}>
          {openCount} open · {links.length} linked
          {lastSynced
            ? ` · synced ${new Date(lastSynced).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : ""}
        </p>
        <label className="mt-2 flex items-center justify-between gap-3">
          Automatically link branch and stack PRs
          <Switch
            checked={thread ? threadPullRequestAutoLinkEnabled(thread) : true}
            onCheckedChange={(pullRequestAutoLink) =>
              void update({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId, pullRequestAutoLink },
              })
            }
          />
        </label>
      </footer>
    </section>
  );
}
