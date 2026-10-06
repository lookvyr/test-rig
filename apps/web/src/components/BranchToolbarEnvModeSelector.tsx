import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { ThreadDetailsSelectControl } from "./chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS } from "./chat/threadDetailsPanelStyles";
import { FolderGit2Icon, FolderGitIcon, FolderIcon, HistoryIcon } from "lucide-react";
import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  resolveWorkspaceDisplayName,
  type EnvMode,
} from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectValue,
} from "./ui/select";

export const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

interface BranchToolbarEnvModeSelectorProps {
  displayMode?: "toolbar" | "panel";
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  workspaceRoot?: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  onUsePreviousWorktree?: () => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  displayMode = "toolbar",
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  workspaceRoot = null,
  onEnvModeChange,
  previousWorktreeLabel,
  onUsePreviousWorktree,
}: BranchToolbarEnvModeSelectorProps) {
  const panel = displayMode === "panel";
  const workspacePath =
    panel && !(effectiveEnvMode === "worktree" && !activeWorktreePath)
      ? (activeWorktreePath ?? workspaceRoot)
      : null;
  const workspaceDisplayName = resolveWorkspaceDisplayName(workspacePath);

  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const envModeItems = useMemo(
    () => [
      {
        value: "local",
        label: workspaceDisplayName ?? resolveCurrentWorkspaceLabel(activeWorktreePath),
      },
      { value: "worktree", label: resolveEnvModeLabel("worktree") },
      ...(showPreviousWorktree && previousWorktreeLabel
        ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
        : []),
    ],
    [activeWorktreePath, previousWorktreeLabel, showPreviousWorktree, workspaceDisplayName],
  );

  const handleWorkspaceContextMenu = (event: ReactMouseEvent) => {
    if (!workspacePath) return;
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    event.stopPropagation();
    void api.contextMenu
      .show([{ id: "copy-path", label: "Copy full path", icon: "copy" }], {
        x: event.clientX,
        y: event.clientY,
      })
      .then((action) => {
        if (action !== "copy-path") return;
        void writeTextToClipboard(workspacePath, "workspace path").then(
          (didCopy) => {
            if (didCopy) {
              toastManager.add({
                type: "success",
                title: "Path copied",
                description: workspacePath,
              });
            }
          },
          (error: unknown) => {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to copy path",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          },
        );
      });
  };

  const stopContextMenuMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey) {
      event.stopPropagation();
    }
  };

  if (envLocked) {
    const lockedRow = (
      <span
        onContextMenu={handleWorkspaceContextMenu}
        className={
          panel
            ? `inline-flex ${THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS}`
            : "inline-flex shrink-0 items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs"
        }
      >
        {activeWorktreePath ? (
          <>
            <FolderGitIcon className="size-3" />
            {workspaceDisplayName ??
              resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
          </>
        ) : (
          <>
            {effectiveEnvMode === "worktree" ? (
              <FolderGit2Icon className="size-3" />
            ) : (
              <FolderIcon className="size-3" />
            )}
            {workspaceDisplayName ??
              resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
          </>
        )}
      </span>
    );
    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup side={panel ? "left" : undefined}>
          {workspacePath ?? resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={effectiveEnvMode}
      onValueChange={(value: string | null) => {
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsSelectControl
              panel={panel}
              className={panel ? "" : "min-w-0 shrink font-medium"}
              aria-label="Workspace"
              onMouseDownCapture={stopContextMenuMouseDown}
              onContextMenu={handleWorkspaceContextMenu}
            />
          }
        >
          {effectiveEnvMode === "worktree" ? (
            <FolderGit2Icon className="size-3" />
          ) : activeWorktreePath ? (
            <FolderGitIcon className="size-3" />
          ) : (
            <FolderIcon className="size-3" />
          )}
          <span
            data-composer-label
            className={
              panel
                ? "min-w-0 flex-1 truncate"
                : "min-w-0 max-w-[240px] truncate transition-[max-width,opacity] duration-300 ease-out group-data-[compact]/composer-context:max-w-0 group-data-[compact]/composer-context:opacity-0"
            }
          >
            <SelectValue />
          </span>
        </TooltipTrigger>
        <TooltipPopup side={panel ? "left" : undefined}>
          {workspacePath ??
            (effectiveEnvMode === "worktree"
              ? resolveEnvModeLabel("worktree")
              : resolveCurrentWorkspaceLabel(activeWorktreePath))}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              {activeWorktreePath ? (
                <FolderGitIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              {resolveCurrentWorkspaceLabel(activeWorktreePath)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <span className="inline-flex items-center gap-1.5">
                <HistoryIcon className="size-3" />
                {previousWorktreeLabel}
              </span>
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
