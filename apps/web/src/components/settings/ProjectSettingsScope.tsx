import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectScopedServerSettingKey } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDownIcon, FolderIcon } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { InlineButton } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  type BranchNamingPatch,
  clearScopedProjectSettings,
  createProjectSettingsSaver,
  projectSettingsAreMixed,
  projectSettingSource,
  projectSettingsPatch,
  resolveProjectSettingsTargets,
} from "./projectSettingsScope.logic";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

function useProjectSettingsScopeValue(environmentId: EnvironmentId) {
  const registry = useContext(RegistryContext);
  const settings = useEnvironmentSettings(environmentId);
  const persist = useAtomCommand(serverEnvironment.updateSettings, "project settings update");
  const save = useMemo(
    () =>
      createProjectSettingsSaver(
        () => registry.get(serverEnvironment.settingsValueAtom(environmentId)),
        async (patch) => {
          const result = await persist({ environmentId, input: { patch } });
          return result._tag === "Success" ? result.value : null;
        },
      ),
    [environmentId, registry, persist],
  );
  const environment = useEnvironment(environmentId);
  const storedSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const groups = useSettingsProjectGroups().filter((group) =>
    group.memberProjects.some((project) => project.environmentId === environmentId),
  );
  const { project: projectKey } = useSearch({ from: "/settings/source-control" });
  const navigate = useNavigate({ from: "/settings/source-control" });
  const group = groups.find((candidate) => candidate.projectKey === projectKey);
  const projectIds =
    projectKey === undefined
      ? null
      : (group?.memberProjects
          .filter((project) => project.environmentId === environmentId)
          .map((project) => project.id) ?? []);
  const targets = resolveProjectSettingsTargets(settings, projectIds);
  const available =
    storedSettings !== null && environment?.connection.phase === "connected" && targets.length > 0;
  return {
    settings: targets[0]?.settings ?? settings,
    groups,
    projectKey,
    projectIds,
    group,
    available,
    selectProject: (project: string | undefined) => {
      void navigate({
        resetScroll: false,
        search: (current) => {
          const { project: _previous, ...rest } = current;
          return { ...rest, ...(project === undefined ? {} : { project }) };
        },
      });
    },
    isMixed: (key: ProjectScopedServerSettingKey) => projectSettingsAreMixed(targets, key),
    source: (key: ProjectScopedServerSettingKey) => projectSettingSource(targets, key),
    update: (patch: BranchNamingPatch) => {
      if (available) void save((current) => projectSettingsPatch(current, projectIds, patch));
    },
    clear: (key: ProjectScopedServerSettingKey) => {
      if (available && projectIds !== null)
        void save((current) => clearScopedProjectSettings(current, projectIds, key));
    },
  };
}

const ProjectSettingsContext = createContext<ReturnType<
  typeof useProjectSettingsScopeValue
> | null>(null);

/** Scope only the enclosed settings; the rest of the page retains its own scope. */
export function ProjectSettingsScope({
  environmentId,
  children,
}: {
  environmentId: EnvironmentId;
  children: ReactNode;
}) {
  const scope = useProjectSettingsScopeValue(environmentId);
  return (
    <ProjectSettingsContext value={scope}>
      <div className="mb-3 rounded-xl border border-border/60 py-3">
        <p className="flex flex-wrap items-center gap-1.5 px-3 text-sm text-muted-foreground sm:px-4">
          Applying branch naming for
          <Menu>
            <MenuTrigger
              aria-label={`Project scope: ${scope.group?.displayName ?? (scope.projectKey ? "Unavailable project" : "All projects")}`}
              render={<InlineButton tone="picker" />}
            >
              {scope.projectKey ? <FolderIcon className="size-3.5" /> : null}
              <span className="max-w-64 truncate">
                {scope.group?.displayName ??
                  (scope.projectKey ? "Unavailable project" : "All projects")}
              </span>
              <ChevronDownIcon aria-hidden className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={scope.projectKey ?? "all"}
                onValueChange={(value) => {
                  if (typeof value === "string")
                    scope.selectProject(value === "all" ? undefined : value);
                }}
              >
                <MenuRadioItem value="all" closeOnClick>
                  All projects
                </MenuRadioItem>
                <MenuSeparator />
                {scope.groups.map((group) => (
                  <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                    <FolderIcon className="size-3.5" />
                    <span className="max-w-72 truncate">{group.displayName}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        </p>
        <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground sm:px-4">
          {scope.projectIds === null
            ? "Defaults for projects without their own values."
            : "Unset values inherit the defaults for all projects."}
        </p>
        {!scope.available ? (
          <p role="status" className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
            {scope.projectKey && !scope.group
              ? "This project is no longer available."
              : "Connect to this environment to edit its settings."}
          </p>
        ) : null}
        <fieldset
          disabled={!scope.available}
          key={`${environmentId}:${scope.projectKey ?? "all"}`}
          className="min-w-0 disabled:opacity-60"
        >
          {children}
        </fieldset>
      </div>
    </ProjectSettingsContext>
  );
}

export function useProjectSettingsScope() {
  const scope = useContext(ProjectSettingsContext);
  if (scope === null) throw new Error("Project settings require ProjectSettingsScope.");
  return scope;
}
