import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { GitListPullRequestsResult } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { GitMergeIcon, GitPullRequestIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../../state/entities";
import { gitEnvironment } from "../../state/git";
import { type EnvironmentQueryView, useEnvironmentQueries } from "../../state/query";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useShortcutModifierState } from "../../shortcutModifierState";
import {
  pullRequestJumpCommandForIndex,
  pullRequestJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowPullRequestJumpHint,
} from "../../keybindings";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { JumpHintBadge } from "../JumpHintBadge";
import {
  pullRequestWorkspaceKey,
  usePullRequestWorkspaceStore,
} from "../../pullRequestWorkspaceStore";
import { cn } from "../../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { isPullRequestSelectionAvailable } from "./selection";
import { PullRequestInspector } from "./PullRequestInspector";
import { PullRequestSelect } from "./PullRequestSelect";
import { buildPullRequestGroups } from "./queue";
import {
  DEFAULT_QUEUE_FILTERS,
  pullRequestProjectKey,
  usePullRequestQueueStore,
} from "./workspaceStore";

function ProjectPullRequests({
  project,
  refreshVersion,
  query,
  items,
  startIndex,
  jumpLabels,
}: {
  project: EnvironmentProject;
  refreshVersion: number;
  query: EnvironmentQueryView<GitListPullRequestsResult>;
  items: GitListPullRequestsResult["pullRequests"];
  startIndex: number;
  jumpLabels: ReadonlyArray<string | null>;
}) {
  const { selection, panelOpen, select, clearSelection } = usePullRequestQueueStore();
  const workspaces = usePullRequestWorkspaceStore((state) => state.entriesByKey);
  const lastRefresh = useRef(refreshVersion);
  useEffect(() => {
    if (lastRefresh.current === refreshVersion) return;
    lastRefresh.current = refreshVersion;
    query.refresh();
  }, [refreshVersion, query.refresh]);
  useEffect(() => {
    if (!selection || query.isPending || query.error || !query.data) return;
    if (selection.environmentId !== project.environmentId || selection.projectId !== project.id)
      return;
    if (!items.some((pr) => pr.url === selection.reference)) clearSelection();
  }, [
    items,
    panelOpen,
    project.environmentId,
    project.id,
    query.data,
    query.error,
    query.isPending,
    selection,
    clearSelection,
  ]);

  return (
    <section aria-label={`${project.title} pull requests`}>
      <div className="flex items-center justify-between border-b bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
        <span className="truncate">{query.data?.repository ?? project.title}</span>
        <span>
          {query.isPending
            ? "Refreshing…"
            : `${items.length} pull request${items.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {query.error && (
        <div role="alert" className="space-y-2 border-b px-5 py-4 text-sm">
          <p className="text-destructive">{query.error}</p>
          <Button variant="outline" size="xs" onClick={query.refresh}>
            Retry {project.title}
          </Button>
        </div>
      )}
      {items.map((pr, index) => {
        const jumpIndex = startIndex + index;
        const jumpLabel = jumpLabels[jumpIndex];
        const workspace =
          workspaces[
            pullRequestWorkspaceKey({
              environmentId: project.environmentId,
              cwd: project.workspaceRoot,
              reference: pr.url,
            })
          ];
        const noteCount = workspace?.notes.length ?? 0;
        return (
          <button
            key={pr.url}
            type="button"
            data-pr-jump-index={jumpIndex < 9 ? jumpIndex : undefined}
            aria-pressed={
              panelOpen &&
              selection?.reference === pr.url &&
              selection.environmentId === project.environmentId &&
              selection.projectId === project.id
            }
            onClick={() =>
              select({
                environmentId: project.environmentId,
                projectId: project.id,
                projectName: project.title,
                cwd: project.workspaceRoot,
                reference: pr.url,
              })
            }
            className="relative block w-full border-b px-5 py-4 text-left hover:bg-accent/40 aria-pressed:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {jumpLabel && <JumpHintBadge label={jumpLabel} />}
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {pr.state === "merged" ? (
                <GitMergeIcon className="size-3.5 text-purple-500" />
              ) : (
                <GitPullRequestIcon
                  className={cn(
                    "size-3.5",
                    pr.state === "open" ? "text-emerald-500" : "text-muted-foreground",
                  )}
                />
              )}
              #{pr.number} · {pr.author} · {new Date(pr.updatedAt).toLocaleDateString()}
            </span>
            <span className="mt-2 block text-sm font-medium leading-relaxed">{pr.title}</span>
            <span className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="capitalize">
                {pr.state === "open" && pr.isDraft ? "Draft" : pr.state}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">+{pr.additions}</span>
              <span className="text-red-600 dark:text-red-400">−{pr.deletions}</span>
              <span>
                {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
              </span>
              {workspace?.linkedTarget && <span>Linked conversation</span>}
              {noteCount > 0 && (
                <span>
                  {noteCount} local {noteCount === 1 ? "note" : "notes"}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {!query.isPending && !query.error && items.length === 0 && (
        <p className="px-5 py-7 text-sm text-muted-foreground">
          No matching pull requests in {project.title}.
        </p>
      )}
      {query.data?.truncated && (
        <p className="px-5 py-3 text-xs text-muted-foreground">
          Showing a limited result set. Narrow the state or involvement filter to find more.
        </p>
      )}
    </section>
  );
}

export function PullRequestWorkspace() {
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const { filters, setFilters, selection, panelOpen, panelExpanded, setPanelOpen, toggleExpanded } =
    usePullRequestQueueStore();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const modifiers = useShortcutModifierState();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWorkspaceWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, handlers } = useResizableWidth({
    storageKey: "test-rig:pull-request-panel-width",
    defaultWidth: 560,
    minWidth: 320,
    maxWidth: workspaceWidth === null ? Infinity : Math.max(320, workspaceWidth - 240),
    edge: "left",
  });
  const selectionAvailable = isPullRequestSelectionAvailable(selection, projects);
  const shownProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          filters.projectKey === "all" ||
          pullRequestProjectKey(project.environmentId, project.id) === filters.projectKey,
      ),
    [projects, filters.projectKey],
  );
  const queryAtoms = useMemo(
    () =>
      shownProjects.map((project) =>
        gitEnvironment.pullRequests({
          environmentId: project.environmentId,
          input: {
            cwd: project.workspaceRoot,
            state: filters.state,
            involvement: filters.involvement,
          },
        }),
      ),
    [shownProjects, filters.state, filters.involvement],
  );
  const queries = useEnvironmentQueries(queryAtoms);
  const groups = buildPullRequestGroups(shownProjects, queries, filters.search);
  const jumpLabels = Array.from({ length: 9 }, (_, index) => {
    const command = pullRequestJumpCommandForIndex(index)!;
    const options = { context: { pullRequestsView: true } };
    return shouldShowPullRequestJumpHint(modifiers, keybindings, command, options)
      ? shortcutLabelForCommand(keybindings, command, options)
      : null;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen())
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { pullRequestsView: true },
      });
      const index = pullRequestJumpIndexFromCommand(command ?? "");
      if (index === null) return;
      event.preventDefault();
      const row = workspaceRef.current?.querySelector<HTMLButtonElement>(
        `[data-pr-jump-index="${index}"]`,
      );
      if (!row) return;
      row.click();
      // Selecting a PR can first restore a hidden queue from expanded review.
      requestAnimationFrame(() => {
        if (!row.isConnected) return;
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background">
      <header
        className={cn(
          "workspace-topbar flex shrink-0 items-center gap-2 border-b px-3 sm:px-5",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          isElectron && "drag-region",
        )}
      >
        <GitPullRequestIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Pull requests</span>
        {selection && !panelOpen && (
          <Button
            className="ml-auto [-webkit-app-region:no-drag]"
            variant="ghost"
            size="sm"
            onClick={() => setPanelOpen(true)}
          >
            Reopen review
          </Button>
        )}
      </header>
      <div ref={workspaceRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            panelOpen && selection && "hidden md:flex",
            panelExpanded && "md:hidden",
          )}
        >
          <div className="space-y-4 border-b px-5 py-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h1 className="text-xl font-medium">Pull requests</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Across projects added to Test Rig · GitHub
                </p>
              </div>
              <Button
                aria-label="Refresh pull requests"
                variant="ghost"
                size="icon-sm"
                onClick={() => setRefreshVersion((value) => value + 1)}
              >
                <RefreshCwIcon />
              </Button>
            </div>
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                aria-label="Search pull requests"
                placeholder="Search title, #, author, or repository"
                value={filters.search}
                onChange={(event) => setFilters({ search: event.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <PullRequestSelect
                aria-label="Filter PR project"
                value={filters.projectKey}
                onChange={(event) => setFilters({ projectKey: event.target.value })}
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option
                    key={pullRequestProjectKey(project.environmentId, project.id)}
                    value={pullRequestProjectKey(project.environmentId, project.id)}
                  >
                    {project.title}
                  </option>
                ))}
              </PullRequestSelect>
              <PullRequestSelect
                aria-label="Filter PR status"
                value={filters.state}
                onChange={(event) =>
                  setFilters({ state: event.target.value as typeof filters.state })
                }
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="merged">Merged</option>
                <option value="all">All states</option>
              </PullRequestSelect>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="PR involvement">
              {(
                [
                  ["all", "All"],
                  ["review-requested", "Review requested"],
                  ["authored", "Authored by me"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={filters.involvement === value ? "secondary" : "ghost"}
                  size="xs"
                  aria-pressed={filters.involvement === value}
                  onClick={() => setFilters({ involvement: value })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {groups.map(({ project, query, items, startIndex }) => (
              <ProjectPullRequests
                key={pullRequestProjectKey(project.environmentId, project.id)}
                project={project}
                query={query}
                items={items}
                startIndex={startIndex}
                jumpLabels={jumpLabels}
                refreshVersion={refreshVersion}
              />
            ))}
            {shownProjects.length === 0 && (
              <div className="space-y-3 p-8 text-sm text-muted-foreground">
                <p>
                  {projects.length === 0
                    ? "Add a project to browse its pull requests."
                    : "The selected project is no longer available."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFilters(DEFAULT_QUEUE_FILTERS)}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </main>
        {panelOpen && selection && (
          <aside
            style={{ "--pr-panel-width": `${width}px` } as CSSProperties}
            className={cn(
              "relative flex min-h-0 w-full min-w-0 max-w-full shrink-0 flex-col border-l",
              panelExpanded ? "md:w-full" : "md:w-(--pr-panel-width)",
            )}
          >
            {!panelExpanded && (
              <RightPanelResizeHandle handlers={handlers} className="hidden touch-none md:block" />
            )}
            {selectionAvailable ? (
              <PullRequestInspector
                key={JSON.stringify(selection)}
                selection={selection}
                refreshVersion={refreshVersion}
                onRefresh={() => setRefreshVersion((value) => value + 1)}
                expanded={panelExpanded}
                onToggleExpanded={toggleExpanded}
                onClose={() => setPanelOpen(false)}
              />
            ) : (
              <div className="space-y-3 p-5 text-sm">
                <p className="text-muted-foreground">
                  {bootstrapped
                    ? "This pull request’s project is unavailable or its folder has changed. Select a pull request from an available project."
                    : "Loading project…"}
                </p>
                <Button variant="outline" size="sm" onClick={() => setPanelOpen(false)}>
                  Close review
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>
    </SidebarInset>
  );
}
