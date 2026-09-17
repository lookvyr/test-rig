import type { GitGetPullRequestDetailsResult } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  GitPullRequestIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { gitEnvironment } from "../../state/git";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "../../lib/utils";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { Button } from "../ui/button";
import { PullRequestChecks, PullRequestFiles } from "./PullRequestSummary";
import type { PullRequestSelection } from "./workspaceStore";

interface PullRequestInspectorProps {
  selection: PullRequestSelection;
  onClose: () => void;
  refreshVersion?: number;
  onRefresh?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function PullRequestInspector({
  selection,
  onClose,
  refreshVersion = 0,
  onRefresh,
  expanded,
  onToggleExpanded,
}: PullRequestInspectorProps) {
  const query = useEnvironmentQuery(
    gitEnvironment.pullRequestDetails({
      environmentId: selection.environmentId,
      input: { cwd: selection.cwd, reference: selection.reference },
    }),
  );
  const lastRefresh = useRef(refreshVersion);
  useEffect(() => {
    if (lastRefresh.current === refreshVersion) return;
    lastRefresh.current = refreshVersion;
    query.refresh();
  }, [refreshVersion, query.refresh]);
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Pull request inspector">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <GitPullRequestIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">
          Review {query.data ? `#${query.data.pullRequest.number}` : "pull request"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label="Refresh pull request details"
            variant="ghost"
            size="icon-xs"
            disabled={query.isPending}
            onClick={onRefresh ?? query.refresh}
          >
            <RefreshCwIcon />
          </Button>
          {onToggleExpanded && (
            <Button
              aria-label={expanded ? "Restore split view" : "Expand review"}
              variant="ghost"
              size="icon-xs"
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
          )}
          <Button aria-label="Close review panel" variant="ghost" size="icon-xs" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>
      {query.error && (
        <div role="alert" className="border-b p-4 text-sm text-destructive">
          {query.error}
          {query.data && " Showing the last loaded snapshot."}
        </div>
      )}
      {query.isPending && !query.data && (
        <p className="p-6 text-sm text-muted-foreground">Loading pull request…</p>
      )}
      {query.data && (
        <InspectorContents
          key={JSON.stringify([selection.environmentId, selection.cwd, query.data.pullRequest.url])}
          details={query.data}
        />
      )}
    </section>
  );
}

function InspectorContents({ details }: { details: GitGetPullRequestDetailsResult }) {
  const pr = details.pullRequest;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <header className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 break-all">
            {details.repository.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "")} / #
            {pr.number}
          </span>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open in GitHub <ExternalLinkIcon aria-hidden className="size-3.5" />
          </a>
        </div>
        <h2 className="break-words text-lg font-medium leading-snug">{pr.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 capitalize",
              pr.state === "open" &&
                !pr.isDraft &&
                "border-success/30 bg-success/10 text-success-foreground",
              pr.state === "merged" && "border-primary/30 bg-primary/10 text-primary",
              pr.state === "closed" && "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {pr.state === "open" && pr.isDraft ? "Draft" : pr.state}
          </span>
          <span>by {pr.author}</span>
        </div>
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{pr.headRefName}</span>
          <span className="px-1.5" aria-label="into">
            →
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5">{pr.baseRefName}</span>
        </p>
      </header>
      <div className="space-y-6 border-t p-4">
        {details.truncated && (
          <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            Some GitHub content was limited. Open the pull request on GitHub for the complete
            record.
          </p>
        )}
        <section className="space-y-3">
          <h3 className="text-xs font-medium">Description</h3>
          <div className="text-sm">
            {details.body ? (
              <PullRequestMarkdown text={details.body} />
            ) : (
              <p className="text-muted-foreground">No description provided.</p>
            )}
          </div>
        </section>
        <PullRequestChecks checks={details.checks} />
        <PullRequestFiles details={details} />
      </div>
    </div>
  );
}
