import type { GitGetPullRequestDetailsResult } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { gitEnvironment } from "../../state/git";
import { useEnvironmentQuery } from "../../state/query";
import { buildPullRequestFeedbackContext } from "../../hooks/usePullRequestHandoff";
import {
  EMPTY_PULL_REQUEST_WORKSPACE,
  pullRequestWorkspaceKey,
  usePullRequestWorkspaceStore,
} from "../../pullRequestWorkspaceStore";
import { cn } from "../../lib/utils";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestConversationActions } from "./PullRequestConversationActions";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { PullRequestChecks, PullRequestFiles } from "./PullRequestSummary";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { PullRequestSelection } from "./workspaceStore";

interface PullRequestInspectorProps {
  selection: PullRequestSelection;
  onClose: () => void;
  refreshVersion?: number;
  onRefresh?: () => void;
  onAddToMessage?: ((context: string) => void) | undefined;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function PullRequestInspector({
  selection,
  onClose,
  refreshVersion = 0,
  onRefresh,
  onAddToMessage,
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
          {query.data &&
            " Showing the last loaded snapshot. Refresh successfully before preparing a message."}
        </div>
      )}
      {query.isPending && !query.data && (
        <p className="p-6 text-sm text-muted-foreground">Loading pull request…</p>
      )}
      {query.data && (
        <InspectorContents
          key={JSON.stringify([selection.environmentId, selection.cwd, query.data.pullRequest.url])}
          selection={selection}
          details={query.data}
          canPrepare={!query.error && !query.isPending}
          onAddToMessage={onAddToMessage}
        />
      )}
    </section>
  );
}

function InspectorContents({
  selection,
  details,
  canPrepare,
  onAddToMessage,
}: {
  selection: PullRequestSelection;
  details: GitGetPullRequestDetailsResult;
  canPrepare: boolean;
  onAddToMessage?: ((context: string) => void) | undefined;
}) {
  const pr = details.pullRequest;
  const scope = useMemo(
    () => ({ environmentId: selection.environmentId, cwd: selection.cwd, reference: pr.url }),
    [selection.environmentId, selection.cwd, pr.url],
  );
  const entry = usePullRequestWorkspaceStore(
    (state) => state.entriesByKey[pullRequestWorkspaceKey(scope)] ?? EMPTY_PULL_REQUEST_WORKSPACE,
  );
  const { addNote, updateNote, removeNote, setNoteDraft } = usePullRequestWorkspaceStore();
  const noteText = entry.noteDraft?.body ?? "";
  const selectedNotes = entry.notes.filter((note) => note.selected);
  const saveNote = () => {
    if (!noteText.trim()) return;
    addNote(scope, {
      ...entry.noteDraft,
      body: noteText.trim(),
      headSha: entry.noteDraft?.headSha ?? pr.headSha,
    });
    setNoteDraft(scope, null);
  };

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
        {!onAddToMessage && (
          <PullRequestConversationActions
            selection={selection}
            details={details}
            entry={entry}
            canPrepare={canPrepare}
          />
        )}
      </header>
      <div role="tablist" aria-label="PR review views" className="flex gap-1 border-b px-3">
        <button
          type="button"
          role="tab"
          id="pr-tab-summary"
          aria-controls="pr-review-content"
          aria-selected
          className="border-b-2 border-primary px-3 py-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Summary
        </button>
        {(["Diff", "Activity"] as const).map((tab) => (
          <Tooltip key={tab}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  aria-disabled="true"
                  className="cursor-not-allowed border-b-2 border-transparent px-3 py-2.5 text-xs text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              {tab}
            </TooltipTrigger>
            <TooltipPopup>Coming soon</TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <div
        id="pr-review-content"
        role="tabpanel"
        aria-labelledby="pr-tab-summary"
        className="space-y-6 p-4"
      >
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
        <details className="rounded-md border bg-muted/15 [&[open]>summary>svg]:rotate-90">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 shrink-0" />
            <span className="font-medium">Local notes</span>
            <span className="ml-auto text-muted-foreground">
              {entry.notes.length
                ? `${selectedNotes.length} of ${entry.notes.length} selected`
                : noteText
                  ? "Unsaved note"
                  : "Optional"}
            </span>
          </summary>
          <div className="space-y-3 border-t p-3">
            <Textarea
              aria-label="Agent note"
              placeholder="What should the agent investigate?"
              value={noteText}
              onChange={(event) =>
                setNoteDraft(scope, {
                  ...entry.noteDraft,
                  body: event.target.value,
                  headSha: entry.noteDraft?.headSha ?? pr.headSha,
                })
              }
              className="min-h-20 text-xs"
            />
            {entry.noteDraft?.filePath && (
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                Draft for {entry.noteDraft.filePath}:{entry.noteDraft.line} ({entry.noteDraft.side})
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Saved locally with this PR.</span>
              <Button size="xs" variant="outline" disabled={!noteText.trim()} onClick={saveNote}>
                Add note
              </Button>
            </div>
            {entry.notes.map((note) => (
              <div key={note.id} className="flex items-start gap-2 border-t pt-3">
                <Checkbox
                  aria-label={`Include note: ${note.body.slice(0, 50)}`}
                  checked={note.selected}
                  onCheckedChange={(selected) => updateNote(scope, note.id, { selected })}
                />
                <div className="min-w-0 flex-1">
                  {note.filePath && (
                    <p className="mb-1 break-all font-mono text-[11px] text-muted-foreground">
                      {note.filePath}:{note.line} ({note.side})
                    </p>
                  )}
                  <Textarea
                    aria-label="Edit local note"
                    className="min-h-16 text-xs"
                    value={note.body}
                    onChange={(event) => updateNote(scope, note.id, { body: event.target.value })}
                  />
                  {note.headSha !== pr.headSha && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Saved against an earlier revision.
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove local note"
                  onClick={() => removeNote(scope, note.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {onAddToMessage && (
              <>
                <Button
                  className="w-full"
                  size="sm"
                  disabled={!canPrepare || selectedNotes.length === 0}
                  onClick={() => {
                    const context = buildPullRequestFeedbackContext(pr, entry.notes);
                    if (context) onAddToMessage(context);
                  }}
                >
                  Add to message
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Adds selected notes to this conversation's unsent message.
                </p>
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
