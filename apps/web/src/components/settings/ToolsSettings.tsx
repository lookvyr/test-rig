import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FilterIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  EnvironmentId,
  SkillLibraryId,
  type ProjectId,
  type McpRuntimeStatus,
  type McpServerConfig,
  type SkillLibraryAssignment,
  type SkillLibraryDetail,
  type SkillLibraryProvider,
  type SkillLibrarySourceReadInput,
  type SkillLibrarySummary,
  type SkillLibraryUpsertInput,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import {
  useEnvironment,
  useEnvironmentHttpBaseUrl,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { useEnvironmentQuery, useLeasedEnvironmentQuery } from "../../state/query";
import { useProjects } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ensureLocalApi } from "../../localApi";
import { usePrimarySessionState } from "../../environments/primary";
import { useEnvironmentSessionState } from "../../state/session";
import { isElectron } from "../../env";
import {
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { McpServerEditor } from "./McpServerEditor";
import { SkillLibraryEditor } from "./SkillLibraryEditor";
import { NativeSkills } from "./NativeSkills";
import {
  ProviderIconToggles,
  ToolsSelect,
  type ToolToggle,
  type ToolsProject,
} from "./ToolsAvailability";
import { ToolsProjectsDialog } from "./ToolsProjectsDialog";
import { mcpServerState, SkillGlyph, ToolStatusDot } from "./ToolStatusDot";
import {
  assignmentIncludesScope,
  assignmentSummary,
  skillEditorDetail,
} from "./toolsSettings.logic";

const isSkillLibraryId = Schema.is(SkillLibraryId);
const PROVIDER_LABELS: Record<SkillLibraryProvider, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};
const NEW_MCP_SERVER: McpServerConfig = {
  enabled: true,
  providers: ["codex", "claudeAgent"],
  assignment: { allProjects: true, projectIds: [], disabledProjectIds: [] },
  transport: { type: "http", url: "", headers: [] },
};

export function ToolsSettings() {
  const search = useSearch({ from: "/_chat/settings/tools" });
  const navigate = useNavigate({ from: "/settings/tools" });
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const id = search.environmentId ? EnvironmentId.make(search.environmentId) : primaryId;
  const environment = useEnvironment(id);
  const physicalProjects = useProjects().filter((project) => project.environmentId === id);
  const projectIds = [...new Set(physicalProjects.map((project) => project.id))].sort();
  const scratchProjectIds = new Set(
    physicalProjects
      .filter((project) =>
        isScratchProject(project, environment?.serverConfig?.scratchWorkspaceRoot),
      )
      .map((project) => project.id),
  );
  const scopes = useLeasedEnvironmentQuery(
    id !== null
      ? serverEnvironment.listToolsProjectScopes({ environmentId: id, input: { projectIds } })
      : null,
    environment?.connection.phase === "connected",
  );
  const projects: ToolsProject[] = (scopes.data?.scopes ?? []).map((scope) => ({
    id: scope.id,
    name: scope.memberProjectIds.some((member) => scratchProjectIds.has(member))
      ? "Scratch chats"
      : (scopes.data?.scopes.filter((entry) => entry.label === scope.label).length ?? 0) > 1
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
      unavailableProjectIds={
        scopes.data?.unavailableProjects?.map((project) => project.projectId) ?? []
      }
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
                Retry
              </Button>
            </p>
          ) : null}
          {scopes.data?.unavailableProjects?.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer hover:text-foreground">
                {scopes.data.unavailableProjects.length} unavailable{" "}
                {scopes.data.unavailableProjects.length === 1 ? "project" : "projects"}
              </summary>
              <ul className="mt-2 space-y-2">
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
                className="mt-2"
                disabled={environment?.connection.phase !== "connected" || scopes.isPending}
                onClick={scopes.refresh}
              >
                Retry
              </Button>
            </details>
          ) : null}
        </>
      }
    />
  );
}

function ToolRow({
  name,
  status,
  attention,
  providers,
  onProviders,
  summary,
  onProjects,
  enabled,
  onEnabled,
  disabled,
  onOpen,
}: {
  name: string;
  status: ReactNode;
  attention?: ReactNode;
  providers: readonly SkillLibraryProvider[];
  onProviders: (providers: SkillLibraryProvider[]) => void;
  summary: string;
  onProjects: () => void;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="relative flex h-11 items-center gap-2.5 px-3 hover:bg-muted/30 sm:px-4">
      {status}
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline",
          enabled === false && "text-muted-foreground",
        )}
      >
        {name}
      </button>
      {attention ? <span className="relative z-10 shrink-0">{attention}</span> : null}
      <span className="flex-1" />
      <span className="relative z-10 flex items-center gap-1">
        <ProviderIconToggles providers={providers} onChange={onProviders} disabled={disabled} />
        <button
          type="button"
          disabled={disabled}
          onClick={onProjects}
          aria-label={`Projects for ${name}: ${summary}`}
          className="min-w-14 rounded-md px-1.5 py-1 text-right text-[13px] text-muted-foreground tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        >
          {summary}
        </button>
        <span className="ml-1.5 flex w-8 justify-end">
          <Switch
            aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onEnabled}
          />
        </span>
      </span>
    </div>
  );
}

function EnvironmentTools({
  environmentId,
  projects,
  unavailableProjectIds,
  connected,
  header,
}: {
  environmentId: EnvironmentId;
  projects: readonly ToolsProject[];
  unavailableProjectIds: readonly ProjectId[];
  connected: boolean;
  header: ReactNode;
}) {
  const registry = useContext(RegistryContext);
  const search = useSearch({ from: "/_chat/settings/tools" });
  const navigate = useNavigate({ from: "/settings/tools" });
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const filterProject = search.project
    ? projects.find(
        (project) =>
          project.id === search.project ||
          project.memberProjectIds.some((member) => member === search.project),
      )
    : undefined;
  const filterProvider =
    search.provider === "codex" || search.provider === "claudeAgent" ? search.provider : null;
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
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
  const canEdit = connected && settings !== null && operateAccess === "granted";
  const library = useEnvironmentQuery(
    connected ? serverEnvironment.listSkillLibrary({ environmentId, input: {} }) : null,
  );
  const statusQuery = useEnvironmentQuery(
    connected ? serverEnvironment.listMcpRuntimeStatuses({ environmentId, input: {} }) : null,
  );
  const oauthQuery = useEnvironmentQuery(
    connected ? serverEnvironment.listMcpOAuthStatuses({ environmentId, input: {} }) : null,
  );
  const refreshOAuth = oauthQuery.refresh;
  const refreshRuntimeStatuses = statusQuery.refresh;
  useEffect(() => {
    if (!connected) return;
    const refresh = () => {
      refreshOAuth();
      refreshRuntimeStatuses();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [connected, refreshOAuth, refreshRuntimeStatuses]);
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
  const beginOAuth = useAtomCommand(serverEnvironment.beginMcpOAuth, { reportFailure: false });
  const completeOAuth = useAtomCommand(serverEnvironment.completeMcpOAuth, {
    reportFailure: false,
  });
  const signOutOAuth = useAtomCommand(serverEnvironment.signOutMcpOAuth, { reportFailure: false });
  const [projectsEditor, setProjectsEditor] = useState<
    { kind: "mcp"; name: string } | { kind: "skill"; entry: SkillLibrarySummary } | null
  >(null);
  const [error, setError] = useState("");
  // Switch and provider changes show at once; each save carries every pending toggle for its tool.
  const pendingToggles = useRef<Readonly<Record<string, ToolToggle>>>({});
  const [toggles, setToggles] = useState(pendingToggles.current);
  const [query, setQuery] = useState("");
  const [savedDetail, setSavedDetail] = useState<SkillLibraryDetail | null>(null);
  const editorDetail = skillEditorDetail(skill.data, savedDetail, skillId);
  const [nativeSource, setNativeSource] = useState<SkillLibrarySourceReadInput | null>(null);
  const source = useEnvironmentQuery(
    connected && nativeSource
      ? serverEnvironment.readSkillLibrarySource({ environmentId, input: nativeSource })
      : null,
  );

  const setSearch = (patch: Record<string, string | undefined>) =>
    void navigate({
      search: (current) => {
        const next: Record<string, string | undefined> = { ...current, ...patch };
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        return next as typeof current;
      },
      resetScroll: !("project" in patch || "provider" in patch),
    });
  const back = () => setSearch({ server: undefined, skill: undefined, signin: undefined });
  const setToggle = (key: string, update: (current: ToolToggle) => ToolToggle) => {
    const { [key]: current = {}, ...rest } = pendingToggles.current;
    const next = update(current);
    pendingToggles.current = Object.keys(next).length > 0 ? { ...rest, [key]: next } : rest;
    setToggles(pendingToggles.current);
  };
  /** Show a toggle immediately, save it, and drop it once saved or failed. */
  const toggle = (key: string, change: ToolToggle, save: () => Promise<void>) => {
    setToggle(key, (current) => ({ ...current, ...change }));
    setError("");
    void save()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "The change could not be saved."),
      )
      .finally(() =>
        setToggle(key, (current) => {
          const next = { ...current };
          if (next.enabled === change.enabled) delete next.enabled;
          if (next.providers === change.providers) delete next.providers;
          return next;
        }),
      );
  };
  const toggleServer = (name: string, change: ToolToggle) =>
    toggle(`mcp:${name}`, change, () => patchServer(name, (config) => config));
  const toggleSkill = (id: SkillLibraryId, change: ToolToggle) =>
    toggle(`skill:${id}`, change, () => patchSkill(id, {}));
  const latestSettings = () => {
    const latest = registry.get(serverEnvironment.settingsValueAtom(environmentId));
    if (!latest || !canEdit) throw new Error("Connect to this environment to edit tools.");
    return latest;
  };
  const writeServers = async (mcpServers: Record<string, McpServerConfig | null>) => {
    const result = await updateSettings({ environmentId, input: { patch: { mcpServers } } });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    statusQuery.refresh();
    oauthQuery.refresh();
  };
  /** Change one saved field without touching unsaved edits elsewhere. */
  const patchServer = async (
    name: string,
    change: (config: McpServerConfig) => McpServerConfig,
  ) => {
    const current = latestSettings().mcpServers[name];
    if (!current) throw new Error("This server no longer exists.");
    await writeServers({
      [name]: change({ ...current, ...pendingToggles.current[`mcp:${name}`] }),
    });
  };
  const saveServer = async (oldName: string, name: string, config: McpServerConfig) => {
    const existing = latestSettings().mcpServers;
    if (name !== oldName && existing[name])
      throw new Error("A server with this name already exists.");
    await writeServers({
      ...(oldName && oldName !== name ? { [oldName]: null } : {}),
      [name]: config,
    });
  };
  // Skills save whole, so their writes run one at a time and each reads the latest copy.
  const skillWrites = useRef<Promise<unknown>>(Promise.resolve());
  const queueSkillWrite = <A,>(write: () => Promise<A>) => {
    const next = skillWrites.current.then(write);
    skillWrites.current = next.catch(() => undefined);
    return next;
  };
  const upsertSkillNow = async (draft: SkillLibraryUpsertInput) => {
    if (!canEdit) throw new Error("This session cannot change the skill library.");
    const result = await upsertSkill({ environmentId, input: draft });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    setSavedDetail(result.value);
    return result.value;
  };
  const saveSkill = (draft: SkillLibraryUpsertInput) =>
    queueSkillWrite(() => upsertSkillNow(draft));
  /** Read the stored copy so unsaved editor text is never sent. */
  const patchSkill = (
    id: SkillLibraryId,
    change: Partial<Pick<SkillLibraryUpsertInput, "assignment">>,
  ) =>
    queueSkillWrite(async () => {
      const read = serverEnvironment.readSkillLibrary({ environmentId, input: { id } });
      registry.refresh(read);
      const detail = await Effect.runPromise(
        AtomRegistry.getResult(registry, read, { suspendOnWaiting: true }),
      );
      await upsertSkillNow({
        id,
        name: detail.name,
        description: detail.description,
        providers: detail.providers,
        instructions: detail.instructions,
        assignment: detail.assignment,
        enabled: detail.enabled,
        ...pendingToggles.current[`skill:${id}`],
        ...change,
      });
      // Wait for the refreshed list so a cleared toggle never shows the old value.
      const list = serverEnvironment.listSkillLibrary({ environmentId, input: {} });
      registry.refresh(list);
      await Effect.runPromise(AtomRegistry.getResult(registry, list, { suspendOnWaiting: true }));
    });
  const serverStatuses = (name: string): McpRuntimeStatus[] =>
    statusQuery.data?.statuses.filter((entry) => entry.serverName === name) ?? [];
  const oauthFor = (name: string) =>
    oauthQuery.data?.statuses.find((entry) => entry.serverName === name) ?? null;
  const serverState = (name: string, config: McpServerConfig) =>
    mcpServerState(config, serverStatuses(name), oauthFor(name), connected && !statusQuery.error);
  const projectsDialog = projectsEditor ? (
    <ToolsProjectsDialog
      toolName={projectsEditor.kind === "mcp" ? projectsEditor.name : projectsEditor.entry.name}
      projects={projects}
      unavailableProjectIds={unavailableProjectIds}
      assignment={
        projectsEditor.kind === "mcp"
          ? (settings?.mcpServers[projectsEditor.name]?.assignment ?? NEW_MCP_SERVER.assignment)
          : projectsEditor.entry.assignment
      }
      onClose={() => setProjectsEditor(null)}
      onSave={(assignment: SkillLibraryAssignment) =>
        projectsEditor.kind === "mcp"
          ? patchServer(projectsEditor.name, (config) => ({ ...config, assignment }))
          : patchSkill(projectsEditor.entry.id, { assignment })
      }
    />
  ) : null;

  if (nativeSource) {
    if (!source.data)
      return (
        <SettingsPageContainer>
          <Button variant="ghost" className="w-fit" onClick={() => setNativeSource(null)}>
            Back
          </Button>
          <p role={source.error ? "alert" : "status"}>{source.error ?? "Loading skill…"}</p>
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
                    providers: ["codex", "claudeAgent"],
                    assignment: filterProject
                      ? {
                          allProjects: false,
                          projectIds: [],
                          disabledProjectIds: [],
                          scopeIds: [filterProject.id],
                        }
                      : NEW_MCP_SERVER.assignment,
                  },
                });
                if (result._tag !== "Success") throw squashAtomCommandFailure(result);
                library.refresh();
                setNativeSource(null);
                setSearch({ skill: result.value.id });
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
          <Button variant="ghost" className="w-fit" onClick={back}>
            Tools
          </Button>
          <p role={skill.error ? "alert" : "status"}>
            {skill.error ?? (skillId ? "Loading skill…" : "This skill is unavailable.")}
          </p>
        </SettingsPageContainer>
      );
    return (
      <SkillLibraryEditor
        key={search.skill}
        detail={
          search.skill === "new" || !editorDetail
            ? null
            : { ...editorDetail, ...toggles[`skill:${editorDetail.id}`] }
        }
        projects={projects}
        unavailableProjectIds={unavailableProjectIds}
        initialAssignment={
          filterProject
            ? {
                allProjects: false,
                projectIds: [],
                disabledProjectIds: [],
                scopeIds: [filterProject.id],
              }
            : NEW_MCP_SERVER.assignment
        }
        onSave={saveSkill}
        onPatch={skillId ? (change) => patchSkill(skillId, change) : undefined}
        onToggle={skillId ? (change) => toggleSkill(skillId, change) : undefined}
        onCreated={(id) => {
          library.refresh();
          setSearch({ skill: id });
        }}
        disabled={!canEdit}
        onBack={back}
        onDelete={
          skillId
            ? async () => {
                const result = await deleteSkill({ environmentId, input: { id: skillId } });
                if (result._tag !== "Success") throw squashAtomCommandFailure(result);
                library.refresh();
              }
            : undefined
        }
      />
    );
  }

  if (search.server) {
    const isNew = search.server === "new";
    const stored = isNew ? undefined : settings?.mcpServers[search.server];
    const saved = stored && { ...stored, ...toggles[`mcp:${search.server}`] };
    if (!isNew && !saved)
      return (
        <SettingsPageContainer>
          <Button variant="ghost" className="w-fit" onClick={back}>
            Tools
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {settings ? "This server no longer exists." : "Loading…"}
          </p>
        </SettingsPageContainer>
      );
    const name = isNew ? "" : search.server;
    return (
      <McpServerEditor
        key={search.server}
        name={name}
        config={
          saved ?? {
            ...NEW_MCP_SERVER,
            assignment: filterProject
              ? {
                  allProjects: false,
                  projectIds: [],
                  disabledProjectIds: [],
                  scopeIds: [filterProject.id],
                }
              : NEW_MCP_SERVER.assignment,
          }
        }
        environmentId={environmentId}
        projects={projects}
        unavailableProjectIds={unavailableProjectIds}
        state={saved ? serverState(name, saved) : null}
        statuses={serverStatuses(name)}
        tools={statusQuery.data?.serverTools?.[name] ?? null}
        disabled={!canEdit}
        autoSignIn={search.signin === "1"}
        onAutoSignInStarted={() => setSearch({ signin: undefined })}
        onBack={back}
        onSave={async (nextName, config) => {
          await saveServer(name, nextName, config);
          if (nextName !== name) setSearch({ server: nextName, signin: undefined });
        }}
        onPatch={(change) => patchServer(name, change)}
        onToggle={(change) => toggleServer(name, change)}
        onDelete={async () => {
          await writeServers({ [name]: null });
          back();
        }}
        oauth={{
          status: oauthFor(name),
          error: !connected ? "Connect to this environment to manage sign-in." : oauthQuery.error,
          pending: oauthQuery.isPending && oauthQuery.data === null,
          refresh: () => {
            oauthQuery.refresh();
            statusQuery.refresh();
          },
          begin: async () => {
            if (!httpBaseUrl) throw new Error("The environment connection is unavailable.");
            const result = await beginOAuth({
              environmentId,
              input: {
                serverName: name,
                callbackUrl: new URL("/oauth/mcp/callback", httpBaseUrl).href,
              },
            });
            if (result._tag !== "Success") throw squashAtomCommandFailure(result);
            return result.value;
          },
          complete: async (input) => {
            const result = await completeOAuth({ environmentId, input });
            if (result._tag !== "Success") throw squashAtomCommandFailure(result);
            oauthQuery.refresh();
            statusQuery.refresh();
          },
          signOut: async () => {
            const result = await signOutOAuth({ environmentId, input: { serverName: name } });
            if (result._tag !== "Success") throw squashAtomCommandFailure(result);
            oauthQuery.refresh();
            statusQuery.refresh();
          },
        }}
        onSessionAction={async (status, action) => {
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
    );
  }

  const term = query.trim().toLowerCase();
  const inFilter = (assignment: SkillLibraryAssignment, toolProviders: readonly string[]) =>
    (!filterProject ||
      assignmentIncludesScope(assignment, filterProject.id, filterProject.memberProjectIds)) &&
    (!filterProvider || toolProviders.includes(filterProvider));
  const servers = Object.entries(settings?.mcpServers ?? {})
    .filter(
      ([name, config]) => name.includes(term) && inFilter(config.assignment, config.providers),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const skills = (library.data?.skills ?? [])
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(term) && inFilter(entry.assignment, entry.providers),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const filtering = Boolean(filterProject || filterProvider || term);
  const empty = (noun: string) => (
    <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
      {filtering ? "No matches" : `No ${noun} yet`}
    </p>
  );
  return (
    <>
      <SettingsPageContainer className="gap-8">
        <div className="space-y-4">
          {header}
          <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4">
            <h1 className="mr-auto text-2xl font-semibold tracking-tight">Tools</h1>
            {filterProject ? (
              <FilterChip
                label="In"
                value={filterProject.name}
                onClear={() => setSearch({ project: undefined })}
              />
            ) : search.project ? (
              <FilterChip
                label="In"
                value="Unavailable project"
                onClear={() => setSearch({ project: undefined })}
              />
            ) : null}
            {filterProvider ? (
              <FilterChip
                label="For"
                value={PROVIDER_LABELS[filterProvider]}
                onClear={() => setSearch({ provider: undefined })}
              />
            ) : null}
            <label className="flex h-8 w-44 items-center gap-2 rounded-lg border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
              <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search"
                aria-label="Search tools"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <Menu>
              <MenuTrigger
                aria-label="Filter tools"
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className={cn((filterProject || filterProvider) && "bg-accent text-foreground")}
                  />
                }
              >
                <FilterIcon className="size-4" />
              </MenuTrigger>
              <MenuPopup align="end" className="max-h-96 min-w-48">
                <MenuGroup>
                  <MenuGroupLabel>Project</MenuGroupLabel>
                  <MenuRadioGroup
                    value={filterProject?.id ?? ""}
                    onValueChange={(value) =>
                      setSearch({
                        project: value === filterProject?.id ? undefined : String(value),
                      })
                    }
                  >
                    {projects.map((project) => (
                      <MenuRadioItem key={project.id} value={project.id}>
                        {project.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Provider</MenuGroupLabel>
                  <MenuRadioGroup
                    value={filterProvider ?? ""}
                    onValueChange={(value) => setSearch({ provider: String(value) })}
                  >
                    {(["codex", "claudeAgent"] as const).map((provider) => (
                      <MenuRadioItem key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          </div>
          {!canEdit ? (
            <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
              {connected && operateAccess !== "granted"
                ? operateAccess === "pending"
                  ? "Checking permissions…"
                  : "This session can view tools but not change them."
                : "Connect to this environment to edit its tools."}
            </p>
          ) : null}
        </div>
        <SettingsSection
          id="mcp-servers"
          title="MCP servers"
          headerAction={
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit}
              onClick={() => setSearch({ server: "new" })}
            >
              <PlusIcon className="size-4" />
              Add server
            </Button>
          }
        >
          {servers.map(([name, saved]) => {
            const config = { ...saved, ...toggles[`mcp:${name}`] };
            const state = serverState(name, config);
            return (
              <ToolRow
                key={name}
                name={name}
                status={<ToolStatusDot state={state} />}
                attention={
                  state.needsSignIn ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-6 bg-warning/10 px-2 text-warning-foreground hover:bg-warning/20"
                      onClick={() => setSearch({ server: name, signin: "1" })}
                    >
                      Sign in
                    </Button>
                  ) : null
                }
                providers={config.providers}
                onProviders={(providers) => toggleServer(name, { providers })}
                summary={assignmentSummary(config.assignment, projects)}
                onProjects={() => setProjectsEditor({ kind: "mcp", name })}
                enabled={config.enabled}
                onEnabled={(enabled) => toggleServer(name, { enabled })}
                disabled={!canEdit}
                onOpen={() => setSearch({ server: name })}
              />
            );
          })}
          {servers.length === 0 ? empty("servers") : null}
        </SettingsSection>
        <SettingsSection
          id="skill-library"
          title="Skills"
          headerAction={
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit}
              onClick={() => setSearch({ skill: "new" })}
            >
              <PlusIcon className="size-4" />
              New skill
            </Button>
          }
        >
          {skills.map((saved) => {
            const entry = { ...saved, ...toggles[`skill:${saved.id}`] };
            return (
              <ToolRow
                key={entry.id}
                name={entry.name}
                status={<SkillGlyph />}
                providers={entry.providers}
                onProviders={(providers) => toggleSkill(entry.id, { providers })}
                summary={assignmentSummary(entry.assignment, projects)}
                onProjects={() => setProjectsEditor({ kind: "skill", entry })}
                enabled={entry.enabled}
                onEnabled={(enabled) => toggleSkill(entry.id, { enabled })}
                disabled={!canEdit}
                onOpen={() => setSearch({ skill: entry.id })}
              />
            );
          })}
          {library.error ? (
            <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
              {library.error}
            </p>
          ) : skills.length === 0 && library.data ? (
            empty("skills")
          ) : null}
        </SettingsSection>
        {filterProject && connected ? (
          <NativeSkills
            key={filterProject.workspaceRoot}
            environmentId={environmentId}
            cwd={filterProject.workspaceRoot}
            providers={providers}
            onOpen={setNativeSource}
          />
        ) : null}
        {error ? (
          <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
            {error}
          </p>
        ) : null}
      </SettingsPageContainer>
      {projectsDialog}
    </>
  );
}

function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/12 pr-1 pl-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-40 truncate">{value}</span>
      <button
        type="button"
        aria-label={`Clear ${label.toLowerCase()} filter`}
        onClick={onClear}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
