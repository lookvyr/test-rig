/* eslint-disable react/no-array-index-key -- Draft variable names are editable and rows have no durable IDs. */
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BracesIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  isValidMcpServerName,
  type EnvironmentId,
  type McpOAuthBeginResult,
  type McpOAuthCompleteInput,
  type McpOAuthStatus,
  type McpRuntimeStatus,
  type McpServerConfig,
  type McpServerTransport,
  type McpServerVariable,
  type McpToolSummary,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { McpOAuthConnection } from "./McpOAuthConnection";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import {
  ProviderToggles,
  ToolField,
  type ToolToggle,
  type ToolsProject,
} from "./ToolsAvailability";
import { ToolsProjectsDialog } from "./ToolsProjectsDialog";
import { ToolStatusDot, type McpServerState } from "./ToolStatusDot";
import { assignmentSummary, MCP_STATUS_LABELS, parseMcpServerJson } from "./toolsSettings.logic";

function SessionTitle({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useThreadShell({ environmentId, threadId });
  return <span className="truncate text-muted-foreground">{thread?.title.trim() || "Chat"}</span>;
}

export interface McpOAuthControls {
  status: McpOAuthStatus | null;
  error: string | null;
  pending: boolean;
  refresh: () => void;
  begin: () => Promise<McpOAuthBeginResult>;
  complete: (input: McpOAuthCompleteInput) => Promise<void>;
  signOut: () => Promise<void>;
}

function validate(name: string, transport: McpServerTransport) {
  if (!isValidMcpServerName(name))
    throw new Error(
      "Use a name starting with a lowercase letter, followed by letters, numbers, - or _.",
    );
  if (transport.type === "http") {
    let url: URL;
    try {
      url = new URL(transport.url);
    } catch {
      throw new Error("Enter a valid HTTP or HTTPS server URL.");
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Enter an HTTP or HTTPS server URL.");
  } else if (!transport.command.trim()) throw new Error("Enter a command.");
  const variables = transport.type === "http" ? transport.headers : transport.env;
  if (variables.some((variable) => !variable.name.trim()))
    throw new Error("Name each variable or remove its row.");
  if (new Set(variables.map((variable) => variable.name)).size !== variables.length)
    throw new Error("Variable names must be unique.");
}

/** One MCP server's page. Text edits wait for Save; toggles and project choices save at once. */
export function McpServerEditor({
  name,
  config,
  environmentId,
  projects,
  unavailableProjectIds,
  state,
  statuses,
  tools,
  disabled,
  autoSignIn,
  onAutoSignInStarted,
  onBack,
  onSave,
  onPatch,
  onToggle,
  onDelete,
  oauth,
  onSessionAction,
}: {
  name: string;
  config: McpServerConfig;
  environmentId: EnvironmentId;
  projects: readonly ToolsProject[];
  unavailableProjectIds?: readonly ProjectId[] | undefined;
  state: McpServerState | null;
  statuses: readonly McpRuntimeStatus[];
  tools: readonly McpToolSummary[] | null;
  disabled: boolean;
  autoSignIn: boolean;
  onAutoSignInStarted: () => void;
  onBack: () => void;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onPatch: (change: (config: McpServerConfig) => McpServerConfig) => Promise<void>;
  /** Switch and provider changes on a saved server; they show at once and save in the background. */
  onToggle: (change: ToolToggle) => void;
  onDelete: () => Promise<void>;
  oauth: McpOAuthControls;
  onSessionAction: (
    status: McpRuntimeStatus,
    action: "reconnect" | "authenticate",
  ) => Promise<void>;
}) {
  const isNew = name === "";
  const [draftName, setDraftName] = useState(name);
  const [transport, setTransport] = useState(config.transport);
  // A new server keeps everything local until it is added.
  const [draft, setDraft] = useState(config);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingProjects, setEditingProjects] = useState(false);
  const current = isNew ? draft : config;
  const dirty =
    !isNew &&
    (draftName !== name || JSON.stringify(transport) !== JSON.stringify(config.transport));
  const leaving = useRef(false);
  const resync = useRef(false);
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setTransport(config.transport);
  }, [config.transport]);
  const blocker = useBlocker({
    shouldBlockFn: () =>
      (dirty || (isNew && (draftName !== "" || transportHasInput(transport)))) && !leaving.current,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const variables = transport.type === "http" ? transport.headers : transport.env;
  const setVariables = (value: readonly McpServerVariable[]) =>
    setTransport(
      transport.type === "http" ? { ...transport, headers: value } : { ...transport, env: value },
    );
  const updateVariable = (index: number, change: Partial<McpServerVariable>) =>
    setVariables(
      variables.map((variable, position) =>
        position === index
          ? {
              ...variable,
              ...(variable.valueRedacted && !variable.storedAs
                ? { storedAs: { server: name, variable: variable.name } }
                : {}),
              ...change,
            }
          : variable,
      ),
    );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const setProviders = (providers: McpServerConfig["providers"]) =>
    isNew ? setDraft({ ...draft, providers }) : onToggle({ providers });
  const save = () =>
    void run(async () => {
      const trimmed = draftName.trim();
      validate(trimmed, transport);
      if (current.providers.length === 0) throw new Error("Choose at least one provider.");
      const renamed = !isNew && trimmed !== name;
      const preserved = variables.map((variable) =>
        variable.valueRedacted && renamed && !variable.storedAs
          ? { ...variable, storedAs: { server: name, variable: variable.name } }
          : variable,
      );
      resync.current = true;
      leaving.current = isNew || renamed;
      try {
        await onSave(trimmed, {
          ...current,
          transport:
            transport.type === "http"
              ? { ...transport, headers: preserved }
              : { ...transport, env: preserved },
        });
      } catch (cause) {
        resync.current = false;
        throw cause;
      }
    }).finally(() => {
      leaving.current = false;
    });
  const discard = () => {
    setDraftName(name);
    setTransport(config.transport);
    setError("");
  };
  const http = config.transport.type === "http" && transport.type === "http";
  const sessions = [
    ...new Map(
      statuses.map((status) => [
        `${status.threadId}:${status.providerSessionId}:${status.runtimeName}`,
        status,
      ]),
    ).values(),
  ].sort((left, right) => left.provider.localeCompare(right.provider));

  return (
    <SettingsPageContainer className="gap-8 pb-24">
      <div className="space-y-4 px-3 sm:px-4">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2.5 w-fit text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
          Tools
        </Button>
        <div className="flex items-center gap-3">
          {state ? <ToolStatusDot state={state} /> : null}
          <h1 className="mr-auto min-w-0 truncate text-2xl font-semibold tracking-tight">
            {isNew ? "New server" : name}
          </h1>
          {isNew ? null : (
            <Switch
              aria-label={`${config.enabled ? "Disable" : "Enable"} ${name}`}
              checked={config.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => onToggle({ enabled })}
            />
          )}
        </div>
      </div>
      <fieldset disabled={disabled || busy} className="contents">
        <SettingsSection
          title="Connection"
          headerAction={
            <Button size="sm" variant="ghost" onClick={() => setJson(json === null ? "" : null)}>
              <BracesIcon className="size-4" />
              {json === null ? "Import JSON" : "Cancel import"}
            </Button>
          }
        >
          {json !== null ? (
            <div className="space-y-3 p-3 sm:p-4">
              <Textarea
                aria-label="Server configuration JSON"
                value={json}
                onChange={(event) => setJson(event.currentTarget.value)}
                placeholder={'{"mcpServers":{"example":{"url":"https://example.com/mcp"}}}'}
                spellCheck={false}
                className="font-mono [&_textarea]:min-h-40"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    try {
                      const parsed = parseMcpServerJson(json);
                      if (parsed.name) setDraftName(parsed.name);
                      setTransport(parsed.config.transport);
                      setJson(null);
                      setError("");
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Invalid JSON.");
                    }
                  }}
                >
                  Use configuration
                </Button>
              </div>
            </div>
          ) : null}
          <ToolField label="Name">
            <Input
              aria-label="Server name"
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              placeholder="my-server"
              autoFocus={isNew}
            />
          </ToolField>
          <ToolField label="Type">
            <span className="flex rounded-lg border p-0.5">
              {(["http", "stdio"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={transport.type === type}
                  onClick={() => {
                    if (transport.type !== type)
                      setTransport(
                        type === "http"
                          ? { type, url: "", headers: [] }
                          : { type, command: "", args: [], env: [] },
                      );
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs",
                    transport.type === type
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {type === "http" ? "URL" : "Command"}
                </button>
              ))}
            </span>
          </ToolField>
          {transport.type === "http" ? (
            <ToolField label="URL">
              <Input
                aria-label="Server URL"
                className="font-mono"
                value={transport.url}
                onChange={(event) => setTransport({ ...transport, url: event.currentTarget.value })}
                placeholder="https://example.com/mcp"
              />
            </ToolField>
          ) : (
            <>
              <ToolField label="Command">
                <Input
                  aria-label="Command"
                  className="font-mono"
                  value={transport.command}
                  onChange={(event) =>
                    setTransport({ ...transport, command: event.currentTarget.value })
                  }
                  placeholder="npx"
                />
              </ToolField>
              <ToolField label="Arguments">
                <Textarea
                  aria-label="Arguments, one per line"
                  className="font-mono"
                  value={transport.args.join("\n")}
                  onChange={(event) =>
                    setTransport({
                      ...transport,
                      args: event.currentTarget.value ? event.currentTarget.value.split("\n") : [],
                    })
                  }
                  placeholder={"-y\n@playwright/mcp@latest"}
                />
              </ToolField>
            </>
          )}
          <div className="space-y-2 px-3 py-3 sm:px-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {transport.type === "http" ? "Headers" : "Environment"}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setVariables([...variables, { name: "", value: "", sensitive: true }])
                }
              >
                <PlusIcon className="size-3.5" />
                Add
              </Button>
            </div>
            {variables.map((variable, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={`Variable name ${index + 1}`}
                  className="font-mono"
                  value={variable.name}
                  placeholder="Name"
                  onChange={(event) => updateVariable(index, { name: event.currentTarget.value })}
                />
                <Input
                  aria-label={`Variable value ${index + 1}`}
                  type="password"
                  autoComplete="new-password"
                  value={variable.value}
                  placeholder={variable.valueRedacted ? "Saved · leave to keep" : "Value"}
                  onChange={(event) =>
                    updateVariable(index, {
                      value: event.currentTarget.value,
                      valueRedacted: false,
                    })
                  }
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove variable ${index + 1}`}
                  onClick={() =>
                    setVariables(variables.filter((_, position) => position !== index))
                  }
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </SettingsSection>
        <SettingsSection title="Availability">
          <ToolField label="Projects">
            <button
              type="button"
              onClick={() => setEditingProjects(true)}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {assignmentSummary(current.assignment, projects)}
            </button>
          </ToolField>
          <ToolField label="Providers">
            <ProviderToggles providers={current.providers} onChange={setProviders} />
          </ToolField>
        </SettingsSection>
        {!isNew && http && config.enabled ? (
          <SettingsSection title="Account" variant="plain">
            <McpOAuthConnection
              status={oauth.status}
              error={oauth.error}
              pending={oauth.pending}
              disabled={disabled || busy}
              autoBegin={autoSignIn}
              onAutoBegin={onAutoSignInStarted}
              onBegin={oauth.begin}
              onComplete={oauth.complete}
              onSignOut={oauth.signOut}
              onRefresh={oauth.refresh}
            />
          </SettingsSection>
        ) : null}
        {isNew ? null : (
          <ToolList
            tools={tools}
            state={state}
            onRetry={
              sessions.some((status) => status.reconnectSupported)
                ? () =>
                    void run(async () => {
                      for (const status of sessions)
                        if (status.reconnectSupported) await onSessionAction(status, "reconnect");
                    })
                : undefined
            }
          />
        )}
        {sessions.length > 0 ? (
          <SettingsSection title="Sessions">
            {sessions.map((status) => (
              <div
                key={`${status.threadId}:${status.providerSessionId}:${status.runtimeName}`}
                className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm sm:px-4"
              >
                <span className="w-16 shrink-0">
                  {status.provider === "claudeAgent" ? "Claude" : "Codex"}
                </span>
                <SessionTitle environmentId={environmentId} threadId={status.threadId} />
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {MCP_STATUS_LABELS[status.state]}
                </span>
                {status.reconnectSupported || (status.authenticateSupported && !http) ? (
                  <Menu>
                    <MenuTrigger
                      aria-label="Session actions"
                      render={<Button size="icon-xs" variant="ghost" />}
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {status.reconnectSupported ? (
                        <MenuItem
                          onClick={() => void run(() => onSessionAction(status, "reconnect"))}
                        >
                          Reconnect
                        </MenuItem>
                      ) : null}
                      {status.authenticateSupported && !http ? (
                        <MenuItem
                          onClick={() => void run(() => onSessionAction(status, "authenticate"))}
                        >
                          Sign in
                        </MenuItem>
                      ) : null}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            ))}
          </SettingsSection>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
          {error}
        </p>
      ) : null}
      {isNew ? null : (
        <div className="flex items-center gap-2 px-3 sm:px-4">
          {confirmDelete ? (
            <>
              <span className="text-sm">Remove {name}?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={disabled || busy}
                onClick={() => {
                  leaving.current = true;
                  void run(onDelete).finally(() => {
                    leaving.current = false;
                  });
                }}
              >
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2.5 text-destructive hover:text-destructive"
              disabled={disabled}
              onClick={() => setConfirmDelete(true)}
            >
              Remove server
            </Button>
          )}
        </div>
      )}
      {isNew || dirty ? (
        <div className="sticky bottom-4 z-20 mx-3 flex items-center justify-end gap-2 rounded-xl border bg-popover/95 p-2 shadow-lg backdrop-blur sm:mx-4">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (isNew) {
                leaving.current = true;
                onBack();
              } else discard();
            }}
          >
            {isNew ? "Cancel" : "Discard"}
          </Button>
          <Button disabled={disabled || busy} onClick={save}>
            {busy ? "Saving…" : isNew ? "Add server" : "Save"}
          </Button>
        </div>
      ) : null}
      {editingProjects ? (
        <ToolsProjectsDialog
          toolName={isNew ? draftName || "New server" : name}
          projects={projects}
          unavailableProjectIds={unavailableProjectIds}
          assignment={current.assignment}
          onClose={() => setEditingProjects(false)}
          onSave={async (assignment) => {
            if (isNew) setDraft({ ...draft, assignment });
            else await onPatch((server) => ({ ...server, assignment }));
          }}
        />
      ) : null}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Your connection changes have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}

const COLLAPSED_TOOLS = 10;

/** The server's tool names; long lists collapse and gain a search. */
function ToolList({
  tools,
  state,
  onRetry,
}: {
  tools: readonly McpToolSummary[] | null;
  state: McpServerState | null;
  onRetry?: (() => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const term = query.trim().toLowerCase();
  const matches = (tools ?? []).filter((tool) => tool.name.toLowerCase().includes(term));
  const shown = term || expanded ? matches : matches.slice(0, COLLAPSED_TOOLS);
  // A server that is off shows no tools; an error or missing sign-in sits above any remembered list.
  const listed = state?.tone === "off" ? null : tools && tools.length > 0 ? tools : null;
  const error = state?.tone === "error";
  const notice =
    state?.tone === "off"
      ? "Off"
      : error
        ? (state.detail ?? "Connection failed")
        : state?.needsSignIn
          ? "Sign in to load tools"
          : listed
            ? null
            : "No tools seen yet";
  return (
    <SettingsSection
      title="Tools"
      titleAction={
        listed ? (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">{listed.length}</span>
        ) : null
      }
      headerAction={
        listed && listed.length > COLLAPSED_TOOLS ? (
          <label className="flex h-7 w-44 items-center gap-2 rounded-lg border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search tools"
              aria-label="Search tools"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        ) : null
      }
    >
      {notice ? (
        <div className="flex min-h-11 items-center gap-3 px-3 py-2 sm:px-4">
          <p
            className={cn(
              "min-w-0 flex-1",
              error
                ? "font-mono text-xs break-words text-destructive"
                : "text-sm text-muted-foreground",
            )}
          >
            {notice}
          </p>
          {error && onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {listed ? (
        <>
          <ul className="grid grid-cols-1 gap-x-6 px-3 py-2 sm:grid-cols-2 sm:px-4">
            {shown.map((tool) => (
              <li
                key={tool.name}
                title={tool.description ?? tool.name}
                className="truncate py-1 font-mono text-xs text-foreground/85"
              >
                {tool.name}
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="py-1 text-sm text-muted-foreground">No tools match</li>
            ) : null}
          </ul>
          {!term && matches.length > COLLAPSED_TOOLS ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="block w-full px-3 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground sm:px-4"
            >
              {expanded ? "Show less" : `Show all ${matches.length}`}
            </button>
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

function transportHasInput(transport: McpServerTransport) {
  return transport.type === "http" ? transport.url !== "" : transport.command !== "";
}
