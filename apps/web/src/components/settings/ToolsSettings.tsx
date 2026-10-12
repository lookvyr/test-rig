import { useContext, useState, type ReactNode } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import {
  EnvironmentId,
  SkillLibraryId,
  type McpRuntimeStatus,
  type McpServerConfig,
  type ToolsScopeId,
  type SkillLibrarySummary,
  type SkillLibraryDetail,
  type SkillLibrarySourceReadInput,
  type SkillLibraryUpsertInput,
} from "@t3tools/contracts";
import { resolveToolsScopeMcpServers } from "@t3tools/shared/projectSettings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { useEnvironment, useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery, useLeasedEnvironmentQuery } from "../../state/query";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ensureLocalApi } from "../../localApi";
import { usePrimarySessionState } from "../../environments/primary";
import { useEnvironmentSessionState } from "../../state/session";
import { isElectron } from "../../env";
import {
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { McpServerDialog } from "./McpServerDialog";
import { SkillLibraryEditor } from "./SkillLibraryEditor";
import { NativeSkills } from "./NativeSkills";
import { ToolsSelect, type ToolsProject } from "./ToolsAvailability";
import {
  assignmentIncludesScope,
  countAssignedSkillScopes,
  EMPTY_SKILL_ASSIGNMENT,
  toggleSkillScope,
  projectMcpServerSettings,
  skillEditorDetail,
  MCP_STATUS_LABELS,
} from "./toolsSettings.logic";

const isSkillLibraryId = Schema.is(SkillLibraryId);

function ToolRow({
  name,
  description,
  status,
  checked,
  disabled,
  openDisabled = false,
  onOpen,
  onToggle,
}: {
  name: string;
  description: string;
  status: ReactNode;
  checked: boolean;
  disabled: boolean;
  openDisabled?: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-5 rounded-xl px-3 py-3 hover:bg-muted/30 sm:px-4">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        disabled={openDisabled}
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{status}</span>
        </span>
        <span
          className="mt-1 block truncate text-[13px] text-muted-foreground/80"
          title={description}
        >
          {description}
        </span>
      </button>
      <Switch
        aria-label={`${checked ? "Disable" : "Enable"} ${name}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

export function ToolsSettings() {
  const search = useSearch({ from: "/settings/tools" });
  const navigate = useNavigate({ from: "/settings/tools" });
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const id = search.environmentId ? EnvironmentId.make(search.environmentId) : primaryId;
  const environment = useEnvironment(id);
  const physicalProjects = useProjects();
  const projectIds = [
    ...new Set(
      physicalProjects
        .filter((project) => project.environmentId === id)
        .map((project) => project.id),
    ),
  ].sort();
  const scopes = useLeasedEnvironmentQuery(
    id !== null
      ? serverEnvironment.listToolsProjectScopes({ environmentId: id, input: { projectIds } })
      : null,
    environment?.connection.phase === "connected",
  );
  const projects: ToolsProject[] = (scopes.data?.scopes ?? []).map((scope) => ({
    id: scope.id,
    name:
      (scopes.data?.scopes.filter((entry) => entry.label === scope.label).length ?? 0) > 1
        ? `${scope.label} · ${scope.workspaceRoot}`
        : scope.label,
    memberProjectIds: scope.memberProjectIds,
    workspaceRoot: scope.workspaceRoot,
  }));
  if (id === null)
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">Connect to an environment to manage tools.</p>
      </SettingsPageContainer>
    );
  return (
    <EnvironmentTools
      key={id}
      environmentId={id}
      projects={projects}
      connected={environment?.connection.phase === "connected"}
      header={
        <>
          {environments.length > 1 ? (
            <ToolsSelect
              label="Tools environment"
              value={id}
              onChange={(environmentId) =>
                void navigate({ search: { environmentId }, resetScroll: false })
              }
              options={environments.map((entry) => ({
                value: entry.environmentId,
                label: entry.label,
              }))}
            />
          ) : null}
          {scopes.error ? (
            <p role="alert" className="text-sm text-destructive">
              {scopes.error}
              <Button size="xs" variant="ghost" onClick={scopes.refresh}>
                Retry project scopes
              </Button>
            </p>
          ) : scopes.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading projects and worktrees…
            </p>
          ) : null}
          {scopes.data?.unavailableProjects?.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer hover:text-foreground">
                {scopes.data.unavailableProjects.length} unavailable{" "}
                {scopes.data.unavailableProjects.length === 1 ? "project" : "projects"}
              </summary>
              <div className="mt-2 space-y-2">
                <p>Some projects are unavailable. Their saved tools settings are preserved.</p>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {scopes.data.unavailableProjects.map((project) => (
                    <li key={project.projectId}>
                      <span className="font-medium text-foreground">{project.title}</span>
                      <span className="block break-all">{project.workspaceRoot}</span>
                      <span className="block">{project.message}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={environment?.connection.phase !== "connected" || scopes.isPending}
                  onClick={scopes.refresh}
                >
                  Retry unavailable projects
                </Button>
              </div>
            </details>
          ) : null}
        </>
      }
    />
  );
}

function EnvironmentTools({
  environmentId,
  projects,
  connected,
  header,
}: {
  environmentId: EnvironmentId;
  projects: readonly ToolsProject[];
  connected: boolean;
  header: ReactNode;
}) {
  const registry = useContext(RegistryContext);
  const search = useSearch({ from: "/settings/tools" });
  const navigate = useNavigate({ from: "/settings/tools" });
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const physicalProjects = useProjects();
  const selectedProject = search.project
    ? projects.find(
        (project) =>
          project.id === search.project ||
          project.memberProjectIds.some((id) => id === search.project),
      )
    : undefined;
  const scopeId = selectedProject?.id ?? null;
  const projectId =
    selectedProject?.memberProjectIds.find((id) => id === search.project) ??
    selectedProject?.memberProjectIds[0] ??
    null;
  const workspaceRoot =
    physicalProjects.find(
      (project) => project.id === projectId && project.environmentId === environmentId,
    )?.workspaceRoot ?? selectedProject?.workspaceRoot;
  const unavailableScope = Boolean(search.project && !selectedProject);
  const primaryId = usePrimaryEnvironmentId();
  const primarySession = usePrimarySessionState();
  const session = useEnvironmentSessionState(environmentId);
  const operateAccess =
    primaryId === environmentId
      ? resolvePrimaryOperateAccess({
          isPrimary: true,
          hasDesktopBridge: isElectron,
          session: primarySession.data,
          isPending: primarySession.isPending,
          hasError: primarySession.error !== null,
        })
      : resolveRemoteOperateAccess({
          session: session.data,
          isPending: session.isPending,
          hasError: session.hasError,
        });
  const canEdit =
    connected && settings !== null && !unavailableScope && operateAccess === "granted";
  const library = useEnvironmentQuery(
    connected ? serverEnvironment.listSkillLibrary({ environmentId, input: {} }) : null,
  );
  const statusQuery = useEnvironmentQuery(
    connected
      ? serverEnvironment.listMcpRuntimeStatuses({
          environmentId,
          input: {},
        })
      : null,
  );
  const skillId =
    search.skill && search.skill !== "new" && isSkillLibraryId(search.skill) ? search.skill : null;
  const skill = useLeasedEnvironmentQuery(
    skillId ? serverEnvironment.readSkillLibrary({ environmentId, input: { id: skillId } }) : null,
    connected,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const upsertSkill = useAtomCommand(serverEnvironment.upsertSkillLibrary, {
    reportFailure: false,
  });
  const deleteSkill = useAtomCommand(serverEnvironment.deleteSkillLibrary, {
    reportFailure: false,
  });
  const importSkill = useAtomCommand(serverEnvironment.importSkillLibrary, {
    reportFailure: false,
  });
  const reconnect = useAtomCommand(serverEnvironment.reconnectMcpServer, { reportFailure: false });
  const authenticate = useAtomCommand(serverEnvironment.authenticateMcpServer, {
    reportFailure: false,
  });
  const [mcpEditor, setMcpEditor] = useState<{
    name: string;
    config: McpServerConfig;
    project: string;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [savedDetail, setSavedDetail] = useState<SkillLibraryDetail | null>(null);
  const editorDetail = skillEditorDetail(skill.data, savedDetail, skillId);
  const [nativeSource, setNativeSource] = useState<SkillLibrarySourceReadInput | null>(null);
  const source = useEnvironmentQuery(
    connected && nativeSource
      ? serverEnvironment.readSkillLibrarySource({ environmentId, input: nativeSource })
      : null,
  );
  const effectiveServers = settings
    ? projectId
      ? resolveToolsScopeMcpServers(settings, projectId, scopeId, selectedProject?.memberProjectIds)
      : settings.mcpServers
    : {};
  const back = () =>
    void navigate({
      search: (current) => {
        const { skill: _skill, tab: _tab, ...rest } = current;
        return rest;
      },
      resetScroll: false,
    });
  const openSkill = (entry: string, tab?: string) =>
    void navigate({
      search: (current) => {
        const { tab: _tab, ...rest } = current;
        return { ...rest, skill: entry, ...(tab ? { tab } : {}) };
      },
      resetScroll: false,
    });
  const run = async (name: string, action: () => Promise<void>) => {
    setPending(name);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setPending(null);
    }
  };
  const saveSkill = async (draft: SkillLibraryUpsertInput) => {
    if (!canEdit) throw new Error("This session cannot change the skill library.");
    const result = await upsertSkill({ environmentId, input: draft });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    setSavedDetail(result.value);
    return result.value;
  };
  const saveMcp = async (name: string, config: McpServerConfig, scope: string, remove = false) => {
    const latest = registry.get(serverEnvironment.settingsValueAtom(environmentId));
    if (!latest || !canEdit) throw new Error("Connect to this environment to edit tools.");
    const old = mcpEditor?.name || name;
    const existing =
      scope === "all"
        ? latest.mcpServers
        : (() => {
            const project = projects.find((entry) => entry.id === scope);
            return resolveToolsScopeMcpServers(
              latest,
              project?.memberProjectIds[0] ?? null,
              scope as ToolsScopeId,
              project?.memberProjectIds,
            );
          })();
    if (!remove && name !== old && existing[name])
      throw new Error("A server with this name already exists in this scope.");
    if (!remove && !mcpEditor?.name && existing[name])
      throw new Error("A server with this name already exists in this scope.");
    const patch =
      scope === "all"
        ? {
            mcpServers: {
              ...(old !== name ? { [old]: null } : {}),
              [name]: remove ? null : config,
            },
          }
        : (() => {
            const id = scope as ToolsScopeId;
            const overrides =
              latest.toolsScopeMcpServers[id] === undefined
                ? {}
                : { mcpServers: latest.toolsScopeMcpServers[id] };
            const scoped = projectMcpServerSettings(
              latest.mcpServers,
              overrides,
              old,
              name,
              config,
              remove,
            );
            const scopeServers = { ...scoped.mcpServers };
            if (old !== name && existing[old]) scopeServers[old] = { enabled: false };
            const members = projects.find((entry) => entry.id === id)?.memberProjectIds ?? [];
            const projectSettingsOverrides = remove
              ? Object.fromEntries(
                  members.map((memberId) => {
                    const previous = latest.projectSettingsOverrides[memberId];
                    const { [old]: _removed, ...remaining } = previous?.mcpServers ?? {};
                    return [memberId, { ...previous, mcpServers: remaining }];
                  }),
                )
              : undefined;
            return {
              toolsScopeMcpServers: { [id]: scopeServers },
              ...(projectSettingsOverrides === undefined ? {} : { projectSettingsOverrides }),
            };
          })();
    const result = await updateSettings({ environmentId, input: { patch } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    statusQuery.refresh();
  };
  const toggleMcp = (name: string, config: McpServerConfig, enabled: boolean) =>
    void run(name, async () => {
      const latest = registry.get(serverEnvironment.settingsValueAtom(environmentId));
      if (!latest || !canEdit) return;
      const patch =
        projectId === null
          ? { mcpServers: { [name]: { ...config, enabled } } }
          : {
              toolsScopeMcpServers: {
                [scopeId!]: {
                  ...latest.toolsScopeMcpServers[scopeId!],
                  [name]: { ...latest.toolsScopeMcpServers[scopeId!]?.[name], enabled },
                },
              },
            };
      const result = await updateSettings({ environmentId, input: { patch } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    });
  const toggleSkill = (entry: SkillLibrarySummary, enabled: boolean) => {
    if (projectId === null && enabled) {
      openSkill(entry.id, "availability");
      return;
    }
    void run(entry.id, async () => {
      const detail = await Effect.runPromise(
        AtomRegistry.getResult(
          registry,
          serverEnvironment.readSkillLibrary({ environmentId, input: { id: entry.id } }),
          { suspendOnWaiting: true },
        ),
      );
      await saveSkill({
        id: entry.id,
        name: detail.name,
        description: detail.description,
        providers: detail.providers,
        instructions: detail.instructions,
        assignment:
          projectId === null
            ? EMPTY_SKILL_ASSIGNMENT
            : toggleSkillScope(
                detail.assignment,
                scopeId!,
                enabled,
                selectedProject!.memberProjectIds,
              ),
      });
    });
  };
  const mcpStatus = (name: string, config: McpServerConfig) => {
    if (!config.enabled) return "Off";
    if (!connected) return "Status unavailable";
    if (statusQuery.error) return "Status unavailable";
    if (!statusQuery.data && statusQuery.isPending) return "Checking status…";
    const entries =
      statusQuery.data?.statuses.filter(
        (entry) =>
          entry.serverName === name &&
          (selectedProject === undefined ||
            selectedProject.memberProjectIds.includes(entry.projectId!)),
      ) ?? [];
    if (entries.length === 0) return "Configured";
    const states = [...new Set(entries.map((entry) => MCP_STATUS_LABELS[entry.state]))];
    return states.join(" · ");
  };
  if (nativeSource) {
    if (!source.data)
      return (
        <SettingsPageContainer>
          <Button variant="ghost" onClick={() => setNativeSource(null)}>
            Back to library
          </Button>
          <p role={source.error ? "alert" : "status"}>{source.error ?? "Loading skill source…"}</p>
          {source.error ? (
            <Button variant="outline" onClick={source.refresh}>
              Retry
            </Button>
          ) : null}
        </SettingsPageContainer>
      );
    return (
      <SkillLibraryEditor
        key={nativeSource.sourcePath}
        readOnly
        detail={source.data}
        source={source.data.path}
        projects={projects}
        onSave={saveSkill}
        onBack={() => setNativeSource(null)}
        onCopy={
          canEdit
            ? async () => {
                const result = await importSkill({
                  environmentId,
                  input: {
                    ...nativeSource,
                    providers: ["codex", "claudeAgent", "opencode"],
                    assignment: EMPTY_SKILL_ASSIGNMENT,
                  },
                });
                if (result._tag !== "Success") throw squashAtomCommandFailure(result);
                library.refresh();
                setNativeSource(null);
                openSkill(result.value.id);
              }
            : undefined
        }
      />
    );
  }
  if (search.skill) {
    if (search.skill !== "new" && !editorDetail)
      return (
        <SettingsPageContainer>
          <Button variant="ghost" onClick={back}>
            Back to library
          </Button>
          <p role={skill.error ? "alert" : "status"}>
            {skill.error ?? (skillId ? "Loading skill…" : "This skill is unavailable.")}
          </p>
          {skill.error ? (
            <Button variant="outline" onClick={skill.refresh}>
              Retry
            </Button>
          ) : null}
        </SettingsPageContainer>
      );
    return (
      <SkillLibraryEditor
        key={search.skill}
        detail={search.skill === "new" ? null : editorDetail}
        projects={projects}
        initialTab={search.tab}
        onSave={saveSkill}
        onCreated={(id) => openSkill(id)}
        disabled={!canEdit}
        statusMessage={
          !canEdit
            ? "Your draft is preserved. Connect with permission to edit tools before saving."
            : undefined
        }
        onBack={back}
        onDelete={
          skillId
            ? async () => {
                const result = await deleteSkill({ environmentId, input: { id: skillId } });
                if (result._tag !== "Success") throw squashAtomCommandFailure(result);
              }
            : undefined
        }
      />
    );
  }
  return (
    <>
      <SettingsPageContainer className="gap-9">
        <div className="space-y-4">
          {header}
          <div className="flex flex-wrap items-center gap-3 px-3 sm:px-4">
            <h1 className="text-2xl font-semibold tracking-tight">Tools in</h1>
            <ToolsSelect
              label="Tools project scope"
              compact
              value={selectedProject?.id ?? search.project ?? "all"}
              onChange={(value) => {
                setMcpEditor(null);
                void navigate({
                  search: (current) =>
                    (() => {
                      const { project: _project, ...rest } = current;
                      return { ...rest, ...(value === "all" ? {} : { project: value }) };
                    })(),
                  resetScroll: false,
                });
              }}
              options={[
                { value: "all", label: "All projects" },
                ...projects.map((entry) => ({ value: entry.id, label: entry.name })),
                ...(unavailableScope && search.project
                  ? [{ value: search.project, label: "Unavailable project" }]
                  : []),
              ]}
            />
          </div>
          {!canEdit ? (
            <p role="status" className="px-3 text-sm text-muted-foreground">
              {unavailableScope
                ? "This project's workspace is unavailable. Select another project or restore access and retry."
                : connected && operateAccess !== "granted"
                  ? operateAccess === "pending"
                    ? "Checking tool permissions…"
                    : "This session can view tools, but cannot change their configuration."
                  : "Connect to this environment to edit its tools."}
            </p>
          ) : null}
        </div>
        {!unavailableScope ? (
          <>
            <SettingsSection
              id="mcp-servers"
              title="MCP servers"
              headerAction={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() =>
                    setMcpEditor({
                      name: "",
                      config: {
                        enabled: true,
                        providers: ["codex", "claudeAgent", "opencode"],
                        transport: { type: "http", url: "", headers: [] },
                      },
                      project: scopeId ?? "all",
                    })
                  }
                >
                  <PlusIcon className="size-4" />
                  Add server
                </Button>
              }
            >
              {Object.entries(effectiveServers).map(([name, config]) => (
                <ToolRow
                  key={name}
                  name={name}
                  description={
                    config.transport.type === "http"
                      ? config.transport.url
                      : [config.transport.command, ...config.transport.args].join(" ")
                  }
                  status={mcpStatus(name, config)}
                  checked={config.enabled}
                  disabled={!canEdit || pending !== null}
                  onOpen={() => {
                    statusQuery.refresh();
                    setMcpEditor({ name, config, project: scopeId ?? "all" });
                  }}
                  onToggle={(enabled) => toggleMcp(name, config, enabled)}
                />
              ))}
              {Object.keys(effectiveServers).length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                  No servers configured.
                </p>
              ) : null}
              <p className="px-3 pt-2 text-xs text-muted-foreground sm:px-4">
                Servers added here run alongside servers configured directly in your providers.
              </p>
            </SettingsSection>
            <SettingsSection
              id="skill-library"
              title="Skill library"
              headerAction={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => openSkill("new")}
                >
                  <PlusIcon className="size-4" />
                  New skill
                </Button>
              }
            >
              {library.data?.skills.map((entry) => {
                const assignedProjects = countAssignedSkillScopes(entry.assignment, projects);
                const checked = projectId
                  ? assignmentIncludesScope(
                      entry.assignment,
                      scopeId!,
                      selectedProject!.memberProjectIds,
                    )
                  : entry.assignment.allProjects || assignedProjects > 0;
                return (
                  <ToolRow
                    key={entry.id}
                    name={entry.name}
                    description={entry.description}
                    status={
                      projectId
                        ? checked
                          ? ""
                          : "Off for this project"
                        : entry.assignment.allProjects
                          ? entry.assignment.disabledProjectIds.length +
                            (entry.assignment.disabledScopeIds?.length ?? 0)
                            ? "All projects, with exceptions"
                            : "All projects"
                          : assignedProjects
                            ? `${assignedProjects} ${assignedProjects === 1 ? "project" : "projects"}`
                            : "Saved only"
                    }
                    checked={checked}
                    disabled={!canEdit || pending !== null}
                    openDisabled={pending !== null}
                    onOpen={() => openSkill(entry.id)}
                    onToggle={(enabled) => toggleSkill(entry, enabled)}
                  />
                );
              })}
              {library.error ? (
                <p role="alert" className="px-3 text-sm text-destructive">
                  {library.error}
                  <Button size="xs" variant="ghost" onClick={library.refresh}>
                    Retry
                  </Button>
                </p>
              ) : !library.data || library.data.skills.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                  {library.isPending
                    ? "Loading skill library…"
                    : "Save a skill to start your library."}
                </p>
              ) : null}
              <p className="px-3 pt-2 text-xs text-muted-foreground sm:px-4">
                {projectId
                  ? "Availability applies to this project and all its worktrees. Restart active sessions to apply changes."
                  : "Open a skill to edit its instructions and project availability."}
              </p>
            </SettingsSection>
          </>
        ) : null}
        {workspaceRoot && connected ? (
          <NativeSkills
            key={workspaceRoot}
            environmentId={environmentId}
            cwd={workspaceRoot}
            providers={providers}
            onOpen={setNativeSource}
          />
        ) : null}
        {error ? (
          <p role="alert" className="px-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsPageContainer>
      {mcpEditor && !unavailableScope ? (
        <McpServerDialog
          environmentId={environmentId}
          key={`${mcpEditor.name}:${mcpEditor.project}`}
          initialName={mcpEditor.name}
          initialConfig={mcpEditor.config}
          initialProject={mcpEditor.project}
          projects={projects}
          statuses={
            statusQuery.data?.statuses.filter(
              (entry) =>
                entry.serverName === mcpEditor.name &&
                (selectedProject === undefined ||
                  selectedProject.memberProjectIds.includes(entry.projectId!)),
            ) ?? []
          }
          onClose={() => setMcpEditor(null)}
          onSave={saveMcp}
          readOnly={!canEdit}
          statusError={
            !connected
              ? "Connect to this environment to check active MCP sessions."
              : statusQuery.error
          }
          statusPending={statusQuery.isPending && statusQuery.data === null}
          onStatusRefresh={statusQuery.refresh}
          onReset={
            mcpEditor.project !== "all" &&
            settings?.mcpServers[mcpEditor.name] &&
            settings.toolsScopeMcpServers[mcpEditor.project as ToolsScopeId]?.[mcpEditor.name]
              ? () => saveMcp(mcpEditor.name, mcpEditor.config, mcpEditor.project, true)
              : undefined
          }
          onDelete={
            mcpEditor.name &&
            (mcpEditor.project === "all" ||
              (!settings?.mcpServers[mcpEditor.name] &&
                settings?.toolsScopeMcpServers[mcpEditor.project as ToolsScopeId]?.[mcpEditor.name]
                  ?.transport))
              ? () => saveMcp(mcpEditor.name, mcpEditor.config, mcpEditor.project, true)
              : undefined
          }
          onAction={async (status: McpRuntimeStatus, action) => {
            const input = { threadId: status.threadId, serverName: status.serverName };
            if (action === "reconnect") {
              const result = await reconnect({ environmentId, input });
              if (result._tag !== "Success") throw squashAtomCommandFailure(result);
            } else {
              const result = await authenticate({ environmentId, input });
              if (result._tag !== "Success") throw squashAtomCommandFailure(result);
              if (result.value.authorizationUrl)
                await ensureLocalApi().shell.openExternal(result.value.authorizationUrl);
            }
            statusQuery.refresh();
          }}
        />
      ) : null}
    </>
  );
}
