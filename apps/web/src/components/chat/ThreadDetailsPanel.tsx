import { useState } from "react";
import { useClientSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { preloadDiffPanel } from "../diffPanelLoader";
import { shortcutLabelForCommand } from "../../keybindings";
import type {
  EditorId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { FileDiffIcon, GitPullRequestIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadDiscoveredPorts } from "../../portDiscoveryState";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { Menu, MenuPopup } from "../ui/menu";
import { OpenInPicker } from "./OpenInPicker";
import { shouldShowOpenInPicker } from "./ChatHeader";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { ThreadDetailsContext } from "./ThreadDetailsContext";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadPullRequestWatches, useWatchedThreadPullRequests } from "./ThreadPullRequestWatches";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";
import { ThreadServersPanel } from "./ThreadServersPanel";
import { resolveThreadDetailsVisibility, THREAD_DETAILS_ITEMS } from "./threadDetailsItems";
import { BranchToolbar, type BranchToolbarProps } from "../BranchToolbar";
import { shouldShowEnvironmentIndicator } from "../BranchToolbar.logic";

export function ThreadDetailsPanel(props: {
  threadRef: ScopedThreadRef;
  toggleContainer: HTMLElement | null;
  projectName: string | undefined;
  scripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  gitCwd: string | null;
  openInCwd: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  isDraft: boolean;
  contextWindow: ContextWindowSnapshot | null;
  findBarOpen: boolean;
  /** The composer strip's workspace and branch controls, shown here as rows. */
  branchToolbar: Omit<BranchToolbarProps, "layout" | "panelSection" | "trailing">;
  onOpenChanges: () => void;
  onShowPullRequest?: (() => void) | undefined;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (id: string, input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (id: string) => Promise<ProjectScriptActionResult>;
}) {
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const visible = useClientSettings(resolveThreadDetailsVisibility);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const gitStatus = useEnvironmentQuery(
    props.gitCwd && visible.changes
      ? vcsEnvironment.status({
          environmentId: props.threadRef.environmentId,
          input: { cwd: props.gitCwd },
        })
      : null,
  ).data;
  const changesTotals = gitStatus?.hasWorkingTreeChanges
    ? gitStatus.workingTree
    : gitStatus?.branchChanges;
  const fileScripts = useT3ProjectFileScripts(
    props.threadRef.environmentId,
    props.scripts && visible.scripts ? props.openInCwd : null,
  );
  const serverCount = useThreadDiscoveredPorts(props.threadRef).length;
  const watchedPullRequests = useWatchedThreadPullRequests(props.threadRef);
  const shortcutLabel = shortcutLabelForCommand(props.keybindings, "threadPanel.toggle");
  const showBranchRows = props.branchToolbar.showGitControls && props.gitCwd !== null;
  // Without git, the workspace row only names a non-primary or switchable environment.
  const { availableEnvironments, environmentId, onEnvironmentChange } = props.branchToolbar;
  const hasEnvironmentRow =
    showBranchRows ||
    shouldShowEnvironmentIndicator({
      activeEnvironment:
        availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null,
      canPickEnvironment: Boolean(
        availableEnvironments && availableEnvironments.length > 1 && onEnvironmentChange,
      ),
    });
  const canOpenIn = shouldShowOpenInPicker({
    activeProjectName: props.projectName,
    activeThreadEnvironmentId: props.threadRef.environmentId,
    primaryEnvironmentId,
  });
  return (
    <ThreadDetailsCard
      threadRef={props.threadRef}
      toggleContainer={props.toggleContainer}
      findBarOpen={props.findBarOpen}
      {...(shortcutLabel ? { shortcutLabel } : {})}
      contentKey={`${THREAD_DETAILS_ITEMS.filter((item) => visible[item.id])
        .map((item) => item.id)
        .join(
          ",",
        )}:${showBranchRows}:${Boolean(props.gitCwd)}:${props.scripts?.map((script) => script.id).join(",")}:${fileScripts.map((script) => script.name).join(",")}:${props.availableEditors.length}:${props.isDraft ? 0 : serverCount}:${Boolean(props.contextWindow)}`}
      onContextMenu={(event) => {
        // Popups the card opens bubble here through React; they, fields, links, and selected
        // text keep their own menus.
        const target = event.target;
        const selection = window.getSelection();
        if (
          !(target instanceof Element) ||
          !event.currentTarget.contains(target) ||
          target.closest("input, textarea, [contenteditable], a[href]") ||
          (selection &&
            !selection.isCollapsed &&
            (event.currentTarget.contains(selection.anchorNode) ||
              event.currentTarget.contains(selection.focusNode)))
        )
          return;
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {(density) => {
        // Section flags follow the rows that will render, so no empty section steals the divider.
        const show = {
          environment: density === "full" && visible.environment && hasEnvironmentRow,
          openIn: density !== "essential" && visible.openIn && canOpenIn,
          scripts: visible.scripts && props.scripts !== undefined,
          branch: visible.branch && showBranchRows,
          pullRequests: visible.branch && props.gitCwd !== null,
          changes:
            visible.changes &&
            props.gitCwd !== null &&
            (!redesign ||
              !props.isDraft ||
              !changesTotals ||
              changesTotals.insertions > 0 ||
              changesTotals.deletions > 0 ||
              Boolean(gitStatus?.hasWorkingTreeChanges)),
        };
        return (
          <>
            <div className="group/details-items">
              {show.environment || show.openIn || show.scripts ? (
                <ThreadDetailsSection
                  title="Workspace"
                  headingId="thread-details-workspace"
                  separated={false}
                  showHeading={false}
                >
                  {show.environment ? (
                    // A remote environment still shows its row without git.
                    <BranchToolbar
                      {...props.branchToolbar}
                      showGitControls={showBranchRows}
                      layout="panel"
                      panelSection="workspace"
                    />
                  ) : null}
                  {show.openIn ? (
                    <OpenInPicker
                      displayMode="panel"
                      environmentId={props.threadRef.environmentId}
                      openInCwd={props.openInCwd}
                      keybindings={props.keybindings}
                      availableEditors={props.availableEditors}
                    />
                  ) : null}
                  {show.scripts && props.scripts ? (
                    <ProjectScriptsControl
                      displayMode="panel"
                      scripts={props.scripts}
                      fileScripts={fileScripts}
                      preferredScriptId={props.preferredScriptId}
                      keybindings={props.keybindings}
                      onRunScript={props.onRunScript}
                      onAddScript={props.onAddScript}
                      onUpdateScript={props.onUpdateScript}
                      onDeleteScript={props.onDeleteScript}
                    />
                  ) : null}
                </ThreadDetailsSection>
              ) : null}
              {show.branch || show.pullRequests || show.changes ? (
                <ThreadDetailsSection
                  title="Version Control"
                  headingId="thread-details-git"
                  showHeading={false}
                  separated={density === "full"}
                >
                  {show.branch ? (
                    <BranchToolbar {...props.branchToolbar} layout="panel" panelSection="branch" />
                  ) : null}
                  {show.changes ? (
                    <ThreadDetailsControl
                      onClick={props.onOpenChanges}
                      onPointerEnter={preloadDiffPanel}
                      onFocus={preloadDiffPanel}
                    >
                      <FileDiffIcon />
                      <span className="flex-1 text-left">Changes</span>
                      <span className="flex items-center gap-1 font-mono text-2xs tabular-nums">
                        <span className="text-success">+{changesTotals?.insertions ?? "…"}</span>
                        <span className="text-destructive">-{changesTotals?.deletions ?? "…"}</span>
                      </span>
                    </ThreadDetailsControl>
                  ) : null}
                  {/* A watched PR is its own row, so it stands in for the generic one. */}
                  {!show.pullRequests ? null : watchedPullRequests.length > 0 ? (
                    <ThreadPullRequestWatches
                      threadRef={props.threadRef}
                      links={watchedPullRequests}
                      onShowPullRequest={props.onShowPullRequest}
                    />
                  ) : props.onShowPullRequest ? (
                    <ThreadDetailsControl onClick={props.onShowPullRequest}>
                      <GitPullRequestIcon />
                      Open PR details
                    </ThreadDetailsControl>
                  ) : null}
                </ThreadDetailsSection>
              ) : null}
              {density === "full" && !props.isDraft && visible.servers ? (
                <ThreadServersPanel
                  environmentId={props.threadRef.environmentId}
                  threadId={props.threadRef.threadId}
                />
              ) : null}
              {density === "full" && visible.automations ? (
                <ThreadAutomationsPanel
                  environmentId={props.threadRef.environmentId}
                  threadId={props.threadRef.threadId}
                />
              ) : null}
              {density === "full" && !props.isDraft && visible.lineage ? (
                <ThreadRelationshipsPanel
                  environmentId={props.threadRef.environmentId}
                  threadId={props.threadRef.threadId}
                  hideWhenEmpty
                />
              ) : null}
              {visible.context && props.contextWindow ? (
                <ThreadDetailsContext usage={props.contextWindow} />
              ) : null}
              {/* Shown only when no section above has content, so an emptied card can be refilled. */}
              <div className="p-2 group-has-[>section>:last-child:not(:empty)]/details-items:hidden">
                <ThreadDetailsControl
                  variant="ghost"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenuPosition({ x: rect.left, y: rect.bottom });
                  }}
                >
                  <SlidersHorizontalIcon />
                  Choose what to show
                </ThreadDetailsControl>
              </div>
            </div>
            <Menu
              open={menuPosition !== null}
              onOpenChange={(open) => !open && setMenuPosition(null)}
            >
              <MenuPopup
                anchor={
                  menuPosition
                    ? {
                        getBoundingClientRect: () =>
                          new DOMRect(menuPosition.x, menuPosition.y, 0, 0),
                      }
                    : undefined
                }
                align="start"
                side="bottom"
              >
                <ThreadDetailsItemsMenuItems />
              </MenuPopup>
            </Menu>
          </>
        );
      }}
    </ThreadDetailsCard>
  );
}
