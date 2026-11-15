import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { forgetAppModalReturnWhen } from "../sidebar/mainAppLocation";
import { readLocalApi } from "../../localApi";
import { deriveProjectGroupingOverrideKey } from "../../logicalProject";
import {
  PROJECT_GROUPING_MODE_LABELS,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useThreadShells } from "../../state/entities";
import { readUnloadedThreadCount } from "../../state/olderSettledShelf";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ITEM_ROW_CLASSNAME } from "./itemRows";
import { ProjectActionsSettings } from "./ProjectActionsSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { DefaultModelRow, DefaultPermissionsRow, NewThreadWorkspaceRow } from "./SettingsPanels";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const GROUPING_SELECTIONS = ["inherit", "repository", "repository_path", "separate"] as const;
type GroupingSelection = (typeof GROUPING_SELECTIONS)[number];

/** Settings → Projects: pick a project, then manage its name, checkouts, defaults, and actions. */
export function ProjectsSettings() {
  const { search, scope, groups, selectScope } = useSettingsScope();
  if (!search.project) {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("projects")}>
          {groups.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
              Add a project from the sidebar to manage it here.
            </p>
          ) : (
            groups.map((group) => (
              <button
                key={group.projectKey}
                type="button"
                className={cn(
                  ITEM_ROW_CLASSNAME,
                  "flex w-full min-w-0 cursor-pointer items-center gap-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                onClick={() => selectScope({ ...search, project: group.projectKey })}
              >
                <ProjectFavicon
                  environmentId={group.environmentId}
                  cwd={group.workspaceRoot}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{group.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {group.workspaceRoot}
                  </span>
                </span>
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  if (scope.kind === "unavailable") {
    return (
      <SettingsPageContainer>
        <div className="flex flex-col items-start gap-3 px-3 sm:px-4">
          <p className="text-sm text-muted-foreground">{scope.message}</p>
          <Button variant="outline" size="xs" onClick={() => selectScope({})}>
            Show all projects
          </Button>
        </div>
      </SettingsPageContainer>
    );
  }
  if (scope.kind !== "project" && scope.kind !== "checkout") return null;
  return <ProjectSettingsPanel group={scope.group} members={scope.members} />;
}

// Grouping overrides are client settings, saved for this device.
function CheckoutGroupingSelect({ member }: { member: SidebarProjectGroupMember }) {
  const overrideKey = deriveProjectGroupingOverrideKey(member);
  const globalMode = useClientSettings((settings) => settings.sidebarProjectGroupingMode);
  const overrides = useClientSettings((settings) => settings.sidebarProjectGroupingOverrides);
  const updateClientSettings = useUpdateClientSettings();
  const selection: GroupingSelection = overrides?.[overrideKey] ?? "inherit";
  return (
    <Select
      value={selection}
      onValueChange={(value) => {
        const next = GROUPING_SELECTIONS.find((candidate) => candidate === value);
        if (!next) return;
        const nextOverrides: Record<string, SidebarProjectGroupingMode> = { ...overrides };
        if (next === "inherit") delete nextOverrides[overrideKey];
        else nextOverrides[overrideKey] = next;
        updateClientSettings({ sidebarProjectGroupingOverrides: nextOverrides });
      }}
    >
      <SelectTrigger
        size="sm"
        className="w-full sm:w-60"
        aria-label={`Grouping rule for ${member.workspaceRoot}`}
      >
        <SelectValue>
          {selection === "inherit"
            ? `Default (${PROJECT_GROUPING_MODE_LABELS[globalMode]})`
            : PROJECT_GROUPING_MODE_LABELS[selection]}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem hideIndicator value="inherit">
          Use global default
        </SelectItem>
        {(["repository", "repository_path", "separate"] as const).map((mode) => (
          <SelectItem hideIndicator key={mode} value={mode}>
            {PROJECT_GROUPING_MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ProjectSettingsPanel({
  group,
  members,
}: {
  group: SidebarProjectSnapshot;
  /** The checkouts the page scope selects: every checkout, or one. */
  members: readonly SidebarProjectGroupMember[];
}) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const nameEdited = useRef(false);
  const selectsEveryCheckout = members.length === group.memberProjects.length;
  const hasMultipleCheckouts = group.memberProjects.length > 1;

  const reportFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };

  const rename = async (value: string) => {
    const title = value.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Project name cannot be empty" });
      return;
    }
    for (const member of members) {
      if (member.title === title) continue;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, title },
      });
      if (result._tag === "Failure") {
        reportFailure("Failed to rename project", result);
        return;
      }
    }
  };

  const removeMembers = async (targets: readonly SidebarProjectGroupMember[]) => {
    const api = readLocalApi();
    if (!api) return;
    const targetKeys = new Set(targets.map((member) => `${member.environmentId}:${member.id}`));
    const targetThreads = threads.filter((thread) =>
      targetKeys.has(`${thread.environmentId}:${thread.projectId}`),
    );
    const threadCount = targetThreads.length + readUnloadedThreadCount(targets, targetThreads);
    const single = targets.length === 1 ? targets[0]! : null;
    const label = single?.title ?? group.displayName;
    const removesWholeProject = targets.length === group.memberProjects.length;
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        [
          threadCount > 0
            ? `Remove project "${label}" and delete its ${threadCount} thread${threadCount === 1 ? "" : "s"}?`
            : `Remove project "${label}"?`,
          ...(single
            ? [
                `Path: ${single.workspaceRoot}`,
                ...(single.environmentLabel ? [`Environment: ${single.environmentLabel}`] : []),
              ]
            : [`This removes ${targets.length} checkout entries.`]),
          ...(threadCount > 0
            ? [
                "This permanently clears conversation history for those threads and cannot be undone.",
              ]
            : []),
          removesWholeProject
            ? "This removes only the project entries, not the files on disk."
            : "Other checkouts of this project are unaffected.",
        ].join("\n"),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    const draftStore = useComposerDraftStore.getState();
    const removedDraftIds: string[] = [];
    for (const member of targets) {
      const hasThreads = targetThreads.some(
        (thread) => thread.environmentId === member.environmentId && thread.projectId === member.id,
      );
      const result = await deleteProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, ...(hasThreads ? { force: true } : {}) },
      });
      if (result._tag === "Failure") {
        reportFailure(`Failed to remove "${member.title}"`, result);
        return;
      }
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      const draft = draftStore.getDraftThreadByProjectRef(projectRef);
      if (draft) {
        removedDraftIds.push(draft.draftId);
        draftStore.clearDraftThread(draft.draftId);
      }
      draftStore.clearProjectDraftThreadId(projectRef);
    }
    // The chat view behind Settings may show a thread or draft that was just deleted.
    const removedIds = [...targetThreads.map((thread) => thread.id), ...removedDraftIds];
    forgetAppModalReturnWhen((href) => removedIds.some((id) => href.includes(id)));
    if (removesWholeProject) {
      void navigate({ to: "/settings/projects", search: {}, replace: true });
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Project">
        <SettingsRow
          title="Name"
          description={
            selectsEveryCheckout
              ? "Shown in the sidebar and project pickers."
              : "Renames the selected checkout only."
          }
          control={
            <Input
              key={`${group.projectKey}:${members.map((member) => member.title).join("\n")}`}
              className="w-full sm:w-72"
              aria-label="Project name"
              defaultValue={members[0]?.title ?? group.displayName}
              onChange={() => {
                nameEdited.current = true;
              }}
              onBlur={(event) => {
                if (nameEdited.current) void rename(event.currentTarget.value);
                nameEdited.current = false;
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id={searchableSetting("project-checkouts").id} title="Checkouts">
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          The grouping rule decides how each checkout joins project groups in the sidebar on this
          device. Changing it can move a checkout to a different project.
        </p>
        {group.memberProjects.map((member) => (
          <SettingsRow
            key={member.physicalProjectKey}
            title={member.environmentLabel ?? "This environment"}
            description={<span className="font-mono">{member.workspaceRoot}</span>}
            control={
              <div className="flex w-full min-w-0 items-center gap-2 @min-[32rem]/settings-row:w-auto">
                <CheckoutGroupingSelect member={member} />
                {hasMultipleCheckouts ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Remove checkout ${member.workspaceRoot}`}
                    onClick={() => void removeMembers([member])}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection title="New threads">
        <DefaultModelRow />
        <DefaultPermissionsRow />
        <NewThreadWorkspaceRow />
      </SettingsSection>

      <ProjectActionsSettings />

      <SettingsSection title="Danger zone">
        <SettingsRow
          title={
            !selectsEveryCheckout
              ? "Remove checkout"
              : hasMultipleCheckouts
                ? "Remove this project everywhere"
                : "Remove project"
          }
          description={
            !selectsEveryCheckout
              ? "Deletes the selected checkout entries and their threads. Other checkouts and files on disk are not touched."
              : hasMultipleCheckouts
                ? `Deletes all ${group.memberProjects.length} checkout entries and their threads. Files on disk are not touched.`
                : "Deletes the project entry and its threads. Files on disk are not touched."
          }
          control={
            <Button
              size="sm"
              variant="destructive-outline"
              onClick={() => void removeMembers(members)}
            >
              <Trash2Icon />
              {!selectsEveryCheckout
                ? "Remove checkout"
                : hasMultipleCheckouts
                  ? "Remove all entries"
                  : "Remove project"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
