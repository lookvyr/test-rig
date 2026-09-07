import type { GitGetPullRequestDetailsResult, GitPullRequestFile } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  GitPullRequestIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { PullRequestSelect } from "./PullRequestSelect";
import { PullRequestConversationActions } from "./PullRequestConversationActions";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { parsePullRequestPatch } from "./diffLines";
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
  const { setTab, setSelectedFile, addNote, updateNote, removeNote, setNoteDraft } =
    usePullRequestWorkspaceStore();
  const noteText = entry.noteDraft?.body ?? "";
  const anchor =
    entry.noteDraft?.filePath && entry.noteDraft.line !== undefined && entry.noteDraft.side
      ? {
          filePath: entry.noteDraft.filePath,
          line: entry.noteDraft.line,
          side: entry.noteDraft.side,
        }
      : null;
  const noteEditorRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (anchor) {
      noteEditorRef.current?.focus();
      noteEditorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [anchor?.filePath, anchor?.line, anchor?.side]);
  const setNoteText = (body: string) =>
    setNoteDraft(scope, {
      ...entry.noteDraft,
      body,
      headSha: entry.noteDraft?.headSha ?? pr.headSha,
    });
  const setAnchor = (next: { filePath: string; line: number; side: "old" | "new" } | null) =>
    setNoteDraft(scope, { body: noteText, headSha: pr.headSha, ...next });
  const [showNotes, setShowNotes] = useState(false);
  const file =
    details.files.find((candidate) => candidate.path === entry.selectedFilePath) ??
    details.files[0];
  const selectedNotes = entry.notes.filter((note) => note.selected);
  const saveNote = () => {
    if (!noteText.trim()) return;
    addNote(scope, {
      body: noteText.trim(),
      headSha: entry.noteDraft?.headSha ?? pr.headSha,
      ...anchor,
    });
    setNoteDraft(scope, null);
    setShowNotes(true);
  };
  const addFinding = (
    body: string,
    location?: { filePath: string; line: number; side: "old" | "new" },
  ) => {
    if (entry.notes.some((note) => note.body === body)) return;
    addNote(scope, { body, headSha: pr.headSha, ...location });
    setShowNotes(true);
  };

  return (
    <>
      <header className="shrink-0 space-y-2 px-4 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {details.repository} / #{pr.number}
          </span>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open pull request on GitHub"
            className="rounded p-1 hover:bg-accent"
          >
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
        <h2 className="text-base font-medium leading-relaxed">{pr.title}</h2>
        <p className="text-xs text-muted-foreground">
          <span
            className={cn(
              "mr-2 capitalize",
              pr.state === "open" && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {pr.state === "open" && pr.isDraft ? "Draft" : pr.state}
          </span>
          Author: {pr.author}
        </p>
        <p className="break-all font-mono text-[11px] text-muted-foreground">
          {pr.headRefName} → {pr.baseRefName}
        </p>
      </header>
      <div
        role="tablist"
        aria-label="PR review views"
        className="flex shrink-0 gap-1 border-b px-3"
      >
        {(["summary", "code", "timeline"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            role="tab"
            id={`pr-tab-${tab}`}
            aria-controls="pr-review-content"
            aria-selected={entry.tab === tab}
            onClick={() => setTab(scope, tab)}
            className="border-b-2 border-transparent px-3 py-2.5 text-xs capitalize text-muted-foreground aria-selected:border-primary aria-selected:text-foreground"
          >
            {tab}
            {tab === "code" && ` (${details.files.length})`}
          </button>
        ))}
      </div>
      <div
        id="pr-review-content"
        role="tabpanel"
        aria-labelledby={`pr-tab-${entry.tab}`}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        {details.truncated && (
          <p className="mb-4 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            Some GitHub content was limited. Open the pull request on GitHub for the complete
            record.
          </p>
        )}
        {entry.tab === "summary" && (
          <div className="space-y-6">
            <div className="text-sm">
              {details.body ? (
                <PullRequestMarkdown text={details.body} />
              ) : (
                <p className="text-muted-foreground">No description provided.</p>
              )}
            </div>
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Checks</h3>
              {details.checks.length === 0 && (
                <p className="text-xs text-muted-foreground">No checks reported.</p>
              )}
              {details.checks.map((check) => {
                const body = `Check: ${check.name}\n${check.conclusion ?? check.status}${check.url ? `\n${check.url}` : ""}`;
                const included = entry.notes.some((note) => note.body === body);
                return (
                  <div
                    key={`${check.name}-${check.url ?? check.status}`}
                    className="rounded-md border p-3"
                  >
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <span className="font-medium">{check.name}</span>
                      <span
                        className={cn(
                          "text-muted-foreground",
                          ["FAILURE", "TIMED_OUT", "ERROR"].includes(
                            check.conclusion?.toUpperCase() ?? "",
                          ) && "text-destructive",
                        )}
                      >
                        {check.conclusion ?? check.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {check.url ? (
                        <a
                          href={check.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground underline"
                        >
                          View check
                        </a>
                      ) : (
                        <span />
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={included}
                        onClick={() => addFinding(body)}
                      >
                        {included ? "Selected" : "Select feedback"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="space-y-1">
              <h3 className="mb-2 text-xs font-medium">Changed files</h3>
              {details.files.map((item) => (
                <button
                  type="button"
                  key={item.path}
                  className="flex w-full items-start gap-2 border-b py-2 text-left text-xs hover:bg-accent/30"
                  onClick={() => {
                    setSelectedFile(scope, item.path);
                    setTab(scope, "code");
                  }}
                >
                  <span className="min-w-0 flex-1 break-all font-mono">{item.path}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">+{item.additions}</span>
                  <span className="text-red-600 dark:text-red-400">−{item.deletions}</span>
                </button>
              ))}
            </section>
          </div>
        )}
        {entry.tab === "code" && (
          <div className="space-y-3">
            {details.files.length > 0 ? (
              <>
                <label className="sr-only" htmlFor="pr-file">
                  Changed file
                </label>
                <PullRequestSelect
                  id="pr-file"
                  className="w-full font-mono"
                  value={file?.path ?? ""}
                  onChange={(event) => {
                    setSelectedFile(scope, event.target.value);
                    setAnchor(null);
                  }}
                >
                  {details.files.map((item) => (
                    <option key={item.path} value={item.path}>
                      {item.path}
                    </option>
                  ))}
                </PullRequestSelect>
                {file && (
                  <PullRequestCode
                    key={`${pr.headSha}:${file.path}`}
                    file={file}
                    onSelectLine={(line, side) => {
                      setAnchor({ filePath: file.path, line, side });
                    }}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No changed files reported.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Use + beside a line to save a local note for the agent.
            </p>
          </div>
        )}
        {entry.tab === "timeline" && (
          <div className="space-y-4">
            <div className="border-l-2 pl-3 text-xs text-muted-foreground">
              {pr.author} opened this pull request · {new Date(pr.createdAt).toLocaleString()}
            </div>
            {details.timeline.map((item) => {
              const body = `${item.author} (${item.kind}${item.state ? `, ${item.state}` : ""}):\n${item.body}`;
              const included = entry.notes.some((note) => note.body === body);
              return (
                <article key={item.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {item.author} · {item.kind.replaceAll("-", " ")}
                    </span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  {item.path && (
                    <p className="break-all font-mono text-xs">
                      {item.path}
                      {item.line !== null && `:${item.line}`}
                    </p>
                  )}
                  <div className="text-sm">
                    <PullRequestMarkdown text={item.body || item.state || "Review submitted"} />
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={included}
                    onClick={() =>
                      addFinding(
                        body,
                        item.path && item.line !== null
                          ? {
                              filePath: item.path,
                              line: item.line,
                              side: item.side === "LEFT" ? "old" : "new",
                            }
                          : undefined,
                      )
                    }
                  >
                    {included ? "Selected" : "Select feedback"}
                  </Button>
                </article>
              );
            })}
            {details.timeline.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments or reviews yet.</p>
            )}
          </div>
        )}
        <section className="mt-5 space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium">
              {anchor
                ? `Local note · ${anchor.side === "old" ? "old" : "new"} line ${anchor.line}`
                : "Local note"}
            </h3>
            {anchor && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Cancel line note"
                onClick={() => setAnchor(null)}
              >
                <XIcon />
              </Button>
            )}
          </div>
          {anchor && (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {anchor.filePath}
            </p>
          )}
          <Textarea
            ref={noteEditorRef}
            aria-label="Agent note"
            placeholder="What should the agent investigate?"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            className="min-h-20 text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Saved locally with this PR.</span>
            <Button size="xs" variant="outline" disabled={!noteText.trim()} onClick={saveNote}>
              Add note
            </Button>
          </div>
        </section>
      </div>
      <footer className="max-h-[48%] shrink-0 space-y-2 overflow-auto border-t bg-muted/15 p-3">
        {entry.notes.length > 0 && (
          <>
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={showNotes}
              onClick={() => setShowNotes(!showNotes)}
            >
              {selectedNotes.length} of {entry.notes.length} notes selected for the agent
            </Button>
            {showNotes && (
              <div className="space-y-3">
                {entry.notes.map((note) => (
                  <div key={note.id} className="flex items-start gap-2 border-b pb-3">
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
                        onChange={(event) =>
                          updateNote(scope, note.id, { body: event.target.value })
                        }
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
              </div>
            )}
          </>
        )}
        {onAddToMessage ? (
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
            <p className="text-center text-[11px] text-muted-foreground">
              {selectedNotes.length
                ? "Adds selected feedback to this conversation. Review and send when ready."
                : "Select comments or save local notes to add to your message."}
            </p>
          </>
        ) : (
          <PullRequestConversationActions
            selection={selection}
            details={details}
            entry={entry}
            canPrepare={canPrepare}
          />
        )}
      </footer>
    </>
  );
}

function PullRequestCode({
  file,
  onSelectLine,
}: {
  file: GitPullRequestFile;
  onSelectLine: (line: number, side: "old" | "new") => void;
}) {
  const lines = useMemo(() => parsePullRequestPatch(file.patch ?? ""), [file.patch]);
  const [visibleLines, setVisibleLines] = useState(400);
  if (!file.patch)
    return (
      <div className="rounded-md border p-5 text-sm text-muted-foreground">
        No text patch available for this file. It may be binary, unchanged, or too large to display.
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="min-w-max font-mono text-[11px] leading-5">
        {lines.slice(0, visibleLines).map((line) => {
          const coordinate = line.newLine ?? line.oldLine;
          return (
            <div
              key={line.id}
              className={cn(
                "flex min-h-5",
                line.kind === "addition" && "bg-emerald-500/10",
                line.kind === "deletion" && "bg-red-500/10",
                line.kind === "hunk" && "bg-muted text-muted-foreground",
              )}
            >
              <span className="w-9 shrink-0 px-1 text-right text-muted-foreground">
                {line.oldLine}
              </span>
              <span className="w-9 shrink-0 px-1 text-right text-muted-foreground">
                {line.newLine}
              </span>
              <span className="flex w-6 shrink-0 items-center justify-center">
                {coordinate !== null && (
                  <button
                    type="button"
                    className="rounded text-muted-foreground hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Add note on ${line.newLine !== null ? "new" : "old"} line ${coordinate}`}
                    onClick={() => onSelectLine(coordinate, line.newLine !== null ? "new" : "old")}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                )}
              </span>
              <code className="whitespace-pre pr-4">{line.text}</code>
            </div>
          );
        })}
      </div>
      {lines.length > visibleLines && (
        <div className="flex items-center justify-between gap-2 border-t p-3">
          <span className="text-xs text-muted-foreground">
            Showing {visibleLines} of {lines.length} patch lines.
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setVisibleLines((value) => value + 400)}
          >
            Show 400 more lines
          </Button>
        </div>
      )}
    </div>
  );
}
