import { useAtomValue } from "@effect/atom-react";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { type EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useScratchProject } from "~/hooks/useScratchProject";
import { primaryServerKeybindingsAtom, primaryServerSettingsAtom } from "~/state/server";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const targetKey = JSON.stringify([
    draftId,
    activeProjectRef?.environmentId,
    activeProjectRef?.projectId,
  ]);
  const latestTarget = useRef<string | null>(targetKey);
  useEffect(() => {
    latestTarget.current = targetKey;
    return () => {
      latestTarget.current = null;
    };
  }, [targetKey]);
  const selectProject = (project: EnvironmentProject) => {
    if (!draftId) return;
    const scratch = isScratchProject(project, scratchWorkspaceRootFor(project.environmentId));
    const envMode = scratch ? "local" : serverSettings.defaultThreadEnvMode;
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(
        deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
        scopeProjectRef(project.environmentId, project.id),
        draftId,
        {
          branch: null,
          worktreePath: null,
          envMode,
          startFromOrigin: envMode === "worktree" && serverSettings.newWorktreesStartFromOrigin,
        },
      );
  };
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const scratchTarget = scratchEnvironmentId(
    activeProjectRef?.environmentId ?? primaryEnvironmentId,
  );
  const activeProject = projects.find(
    (project) =>
      project.id === activeProjectRef?.projectId &&
      project.environmentId === activeProjectRef.environmentId,
  );
  const isScratchDraft =
    activeProject !== undefined &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));
  const shouldShowProjectMenu = canChooseProject || scratchTarget !== null;
  const startScratch = async () => {
    if (!scratchTarget || !draftId) return;
    const requested = latestTarget.current;
    const project = await openScratchProject(scratchTarget);
    if (project && latestTarget.current === requested) selectProject(project);
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <MenuTrigger
        aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
        className={cn(
          "pointer-events-auto inline-block border-foreground/60 border-b border-dotted align-bottom text-foreground transition-colors hover:border-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          isScratchDraft ? "whitespace-nowrap" : "max-w-[min(20rem,calc(100%-1ch))] truncate",
        )}
        title={activeProjectDisplayName ?? undefined}
      >
        {isScratchDraft ? "No project" : (activeProjectDisplayName ?? "Choose a project")}
      </MenuTrigger>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={isScratchDraft ? "no-project" : activeProjectKey}
          onValueChange={(value) => {
            if (value === "no-project") {
              void startScratch();
              return;
            }
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            selectProject(entry.targetProject);
          }}
        >
          {scratchTarget !== null && (
            <MenuRadioItem value="no-project" closeOnClick>
              No project
            </MenuRadioItem>
          )}
          {projectPickerEntries
            .filter(
              ({ targetProject }) =>
                !isScratchProject(
                  targetProject,
                  scratchWorkspaceRootFor(targetProject.environmentId),
                ),
            )
            .map(({ group }) => {
              return (
                <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                  <span className="block min-w-0 truncate" title={group.displayName}>
                    {group.displayName}
                  </span>
                </MenuRadioItem>
              );
            })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-2">
      <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        {isScratchDraft ? (
          <>What should we work on?</>
        ) : hasResolvedProject ? (
          <>What should we build in {projectSelector}?</>
        ) : canChooseProject ? (
          <>{projectSelector} to start</>
        ) : (
          <>Add a project to start</>
        )}
      </h1>
      {isScratchDraft ? (
        <div className="text-sm text-muted-foreground">{projectSelector}</div>
      ) : (
        scratchTarget !== null && (
          <button
            type="button"
            className="pointer-events-auto text-sm text-muted-foreground hover:text-foreground"
            title={shortcutLabelForCommand(keybindings, "chat.newWithoutProject") ?? undefined}
            onClick={() => void startScratch()}
          >
            or start without a project
          </button>
        )
      )}
    </div>
  );
}
