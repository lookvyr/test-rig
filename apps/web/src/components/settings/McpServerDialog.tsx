/* eslint-disable react/no-array-index-key -- Draft variable names are editable and rows have no durable IDs. */
import { useState } from "react";
import {
  ArrowLeftIcon,
  BracesIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  isValidMcpServerName,
  type EnvironmentId,
  type ThreadId,
  type McpServerConfig,
  type McpServerVariable,
  type McpRuntimeStatus,
  type McpOAuthStatus,
  type McpOAuthBeginResult,
  type McpOAuthCompleteInput,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ProviderAvailability, ToolsSelect, type ToolsProject } from "./ToolsAvailability";
import { MCP_STATUS_LABELS, parseMcpServerJson } from "./toolsSettings.logic";
import { useThreadShell } from "../../state/entities";
import { McpOAuthConnection } from "./McpOAuthConnection";

function McpChatTitle({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useThreadShell({ environmentId, threadId });
  return (
    <p className="truncate text-xs text-muted-foreground">
      {thread?.title.trim() || "Active chat"}
    </p>
  );
}

function ConnectionRow({
  environmentId,
  status,
  showTitle,
  disabled,
  sharedAuthentication,
  onAction,
}: {
  environmentId: EnvironmentId;
  status: McpRuntimeStatus;
  showTitle: boolean;
  disabled: boolean;
  sharedAuthentication: boolean;
  onAction: (action: "reconnect" | "authenticate") => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{MCP_STATUS_LABELS[status.state]}</span>
          <span className="text-xs text-muted-foreground">
            {status.provider === "claudeAgent" ? "Claude" : "Codex"}
            {status.toolCount === null
              ? ""
              : ` · ${status.toolCount} ${status.toolCount === 1 ? "tool" : "tools"}`}
          </span>
        </div>
        {showTitle ? (
          <McpChatTitle environmentId={environmentId} threadId={status.threadId} />
        ) : null}
        {status.error ? (
          <p role="alert" className="text-xs text-destructive">
            {status.error}
          </p>
        ) : null}
      </div>
      {status.reconnectSupported || (status.authenticateSupported && !sharedAuthentication) ? (
        <Menu>
          <MenuTrigger
            disabled={disabled}
            aria-label="Connection actions"
            render={<Button size="icon-xs" variant="ghost" />}
          >
            <MoreHorizontalIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            {status.reconnectSupported ? (
              status.provider === "codex" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={<MenuItem disabled={disabled} onClick={() => onAction("reconnect")} />}
                  >
                    Reload provider MCPs
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-64">
                    Reloads MCP connections for every conversation using this Codex provider
                    session.
                  </TooltipPopup>
                </Tooltip>
              ) : (
                <MenuItem disabled={disabled} onClick={() => onAction("reconnect")}>
                  Reconnect
                </MenuItem>
              )
            ) : null}
            {status.authenticateSupported && !sharedAuthentication ? (
              <MenuItem disabled={disabled} onClick={() => onAction("authenticate")}>
                Sign in
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}

export function McpServerDialog({
  environmentId,
  initialName,
  initialConfig,
  initialProject,
  projects,
  statuses,
  onAction,
  onSave,
  onDelete,
  onReset,
  readOnly = false,
  statusError,
  statusPending,
  onStatusRefresh,
  oauthStatus,
  oauthError,
  oauthPending,
  onOAuthRefresh,
  onOAuthBegin,
  onOAuthComplete,
  onOAuthSignOut,
  onClose,
}: {
  environmentId: EnvironmentId;
  initialName: string;
  initialConfig: McpServerConfig;
  initialProject: string;
  projects: readonly ToolsProject[];
  statuses: readonly McpRuntimeStatus[];
  onAction: (status: McpRuntimeStatus, action: "reconnect" | "authenticate") => Promise<void>;
  onSave: (name: string, config: McpServerConfig, project: string) => Promise<void>;
  onDelete?: (() => Promise<void>) | undefined;
  onReset?: (() => Promise<void>) | undefined;
  readOnly?: boolean;
  statusError: string | null;
  statusPending: boolean;
  onStatusRefresh: () => void;
  oauthStatus: McpOAuthStatus | null;
  oauthError: string | null;
  oauthPending: boolean;
  onOAuthRefresh: () => void;
  onOAuthBegin: () => Promise<McpOAuthBeginResult>;
  onOAuthComplete: (input: McpOAuthCompleteInput) => Promise<void>;
  onOAuthSignOut: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState("configuration");
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const importView = tab === "configuration" && json !== null;
  const sessionStatuses = [
    ...new Map(
      statuses.map((status) => [
        `${status.threadId}:${status.providerSessionId}:${status.runtimeName}`,
        status,
      ]),
    ).values(),
  ].sort((left, right) => left.provider.localeCompare(right.provider));
  const sessionCounts = new Map<string, number>();
  for (const status of sessionStatuses)
    sessionCounts.set(status.provider, (sessionCounts.get(status.provider) ?? 0) + 1);
  const hasConnectionError =
    statusError !== null ||
    sessionStatuses.some((status) => status.error || status.state === "failed");
  const transport = config.transport;
  const variables = transport.type === "http" ? transport.headers : transport.env;
  const updateVariables = (value: readonly McpServerVariable[]) =>
    setConfig({
      ...config,
      transport:
        transport.type === "http" ? { ...transport, headers: value } : { ...transport, env: value },
    });
  const updateVariable = (index: number, change: Partial<McpServerVariable>) =>
    updateVariables(
      variables.map((variable, current) =>
        current === index
          ? {
              ...variable,
              ...(variable.valueRedacted && !variable.storedAs
                ? { storedAs: { server: initialName, variable: variable.name } }
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
  const save = () =>
    void run(async () => {
      const trimmed = name.trim();
      if (!isValidMcpServerName(trimmed))
        throw new Error(
          "Use a name starting with a lowercase letter, followed by letters, numbers, - or _. Test Rig names are reserved.",
        );
      if (config.providers.length === 0) throw new Error("Choose at least one provider.");
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
      if (variables.some((variable) => !variable.name.trim()))
        throw new Error("Name each variable or remove its row.");
      if (new Set(variables.map((variable) => variable.name)).size !== variables.length)
        throw new Error("Variable names must be unique.");
      const preserved = variables.map((variable) =>
        variable.valueRedacted && trimmed !== initialName && !variable.storedAs
          ? { ...variable, storedAs: { server: initialName, variable: variable.name } }
          : variable,
      );
      await onSave(
        trimmed,
        {
          ...config,
          transport:
            transport.type === "http"
              ? { ...transport, headers: preserved }
              : { ...transport, env: preserved },
        },
        project,
      );
      onClose();
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initialName ? initialName : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Managed by Test Rig. Changes apply to new or restarted agent sessions.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex gap-1 border-b pb-2">
            {["configuration", "availability", ...(initialName ? ["connections"] : [])].map(
              (value) => (
                <Button
                  key={value}
                  size="sm"
                  disabled={busy}
                  variant={tab === value ? "secondary" : "ghost"}
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value === "configuration"
                    ? "Configuration"
                    : value === "availability"
                      ? "Availability"
                      : "Connections"}
                  {value === "connections" && hasConnectionError ? (
                    <span
                      className="size-1.5 rounded-full bg-destructive"
                      aria-label="Connection error"
                    />
                  ) : null}
                </Button>
              ),
            )}
          </div>
          {importView ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              className="w-fit"
              onClick={() => {
                setJson(null);
                setError("");
              }}
            >
              <ArrowLeftIcon className="size-3.5" />
              Back to configuration
            </Button>
          ) : null}
          {tab === "connections" ? (
            <div className="space-y-3">
              {initialConfig.transport.type === "http" ? (
                <McpOAuthConnection
                  status={oauthStatus}
                  error={oauthError}
                  pending={oauthPending}
                  disabled={busy || readOnly}
                  onBegin={onOAuthBegin}
                  onComplete={onOAuthComplete}
                  onSignOut={onOAuthSignOut}
                  onRefresh={onOAuthRefresh}
                />
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Active sessions</p>
                <Button size="xs" variant="ghost" disabled={busy} onClick={onStatusRefresh}>
                  {statusError ? "Retry" : "Refresh"}
                </Button>
              </div>
              {!initialConfig.enabled ? (
                <p className="text-xs text-muted-foreground">
                  Saved configuration is off. Existing sessions keep their connections until
                  restarted.
                </p>
              ) : null}
              {statusError ? (
                <p role="alert" className="text-sm text-destructive">
                  {statusError}
                </p>
              ) : statusPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Checking active sessions…
                </p>
              ) : sessionStatuses.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {initialConfig.enabled
                    ? "Configured · no active session"
                    : "Off · no active session"}
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {sessionStatuses.map((status) => (
                    <ConnectionRow
                      key={`${status.threadId}:${status.providerSessionId}:${status.runtimeName}`}
                      environmentId={environmentId}
                      status={status}
                      showTitle={(sessionCounts.get(status.provider) ?? 0) > 1}
                      disabled={busy || readOnly}
                      sharedAuthentication={initialConfig.transport.type === "http"}
                      onAction={(action) => void run(() => onAction(status, action))}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <fieldset disabled={busy || readOnly} className="contents">
              {tab === "configuration" ? (
                <div className="space-y-4">
                  {json !== null ? (
                    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-sm font-medium">Import JSON</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Paste one MCP server configuration to fill its connection settings.
                          </p>
                        </div>
                      </div>
                      <label className="block space-y-1.5 text-sm font-medium">
                        Server configuration JSON
                        <Textarea
                          value={json}
                          onChange={(event) => setJson(event.currentTarget.value)}
                          placeholder={
                            '{"mcpServers":{"example":{"url":"https://example.com/mcp"}}}'
                          }
                          spellCheck={false}
                          className="font-mono [&_textarea]:min-h-48"
                        />
                      </label>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => {
                            try {
                              const parsed = parseMcpServerJson(json);
                              if (parsed.name) setName(parsed.name);
                              setConfig((current) => ({
                                ...current,
                                transport: parsed.config.transport,
                              }));
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
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Connection</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => setJson("")}
                        >
                          <BracesIcon className="size-3.5" />
                          Import JSON
                        </Button>
                      </div>
                      <label className="block space-y-1.5 text-sm font-medium">
                        Name
                        <Input
                          value={name}
                          onChange={(event) => setName(event.currentTarget.value)}
                          placeholder="my-server"
                        />
                      </label>
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium">Connection type</p>
                        <div className="flex gap-1">
                          {(["http", "stdio"] as const).map((type) => (
                            <Button
                              key={type}
                              size="sm"
                              variant={transport.type === type ? "secondary" : "outline"}
                              aria-pressed={transport.type === type}
                              onClick={() => {
                                if (transport.type !== type)
                                  setConfig({
                                    ...config,
                                    transport:
                                      type === "http"
                                        ? { type, url: "", headers: [] }
                                        : { type, command: "", args: [], env: [] },
                                  });
                              }}
                            >
                              {type === "http" ? "URL · HTTP" : "Command · stdio"}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {transport.type === "http" ? (
                        <label className="block space-y-1.5 text-sm font-medium">
                          Server URL
                          <Input
                            value={transport.url}
                            onChange={(event) =>
                              setConfig({
                                ...config,
                                transport: { ...transport, url: event.currentTarget.value },
                              })
                            }
                            placeholder="https://example.com/mcp"
                          />
                        </label>
                      ) : (
                        <>
                          <label className="block space-y-1.5 text-sm font-medium">
                            Command
                            <Input
                              value={transport.command}
                              onChange={(event) =>
                                setConfig({
                                  ...config,
                                  transport: { ...transport, command: event.currentTarget.value },
                                })
                              }
                              placeholder="npx"
                            />
                          </label>
                          <label className="block space-y-1.5 text-sm font-medium">
                            Arguments
                            <Textarea
                              value={transport.args.join("\n")}
                              onChange={(event) =>
                                setConfig({
                                  ...config,
                                  transport: {
                                    ...transport,
                                    args: event.currentTarget.value
                                      ? event.currentTarget.value.split("\n")
                                      : [],
                                  },
                                })
                              }
                              placeholder={"-y\n@playwright/mcp@latest"}
                              className="font-mono"
                            />
                            <span className="block text-xs font-normal text-muted-foreground">
                              One argument per line. Spaces within an argument are preserved.
                            </span>
                          </label>
                        </>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {transport.type === "http" ? "Headers" : "Environment variables"}
                          </p>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              updateVariables([
                                ...variables,
                                { name: "", value: "", sensitive: true },
                              ])
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
                              value={variable.name}
                              placeholder="Name"
                              onChange={(event) =>
                                updateVariable(index, { name: event.currentTarget.value })
                              }
                            />
                            <Input
                              aria-label={`Variable value ${index + 1}`}
                              type="password"
                              autoComplete="new-password"
                              value={variable.value}
                              placeholder={
                                variable.valueRedacted
                                  ? "Saved secret · leave to keep"
                                  : "Secret value"
                              }
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
                                updateVariables(variables.filter((_, current) => current !== index))
                              }
                            >
                              <XIcon className="size-4" />
                            </Button>
                          </div>
                        ))}
                        {variables.length ? (
                          <p className="text-xs text-muted-foreground">
                            Sensitive values are saved in this environment’s secret store.
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Configured for</p>
                    <ToolsSelect
                      value={project}
                      onChange={setProject}
                      disabled={Boolean(initialName)}
                      label="MCP project availability"
                      options={[
                        { value: "all", label: "All projects" },
                        ...projects.map((entry) => ({ value: entry.id, label: entry.name })),
                      ]}
                    />
                  </div>
                  <ProviderAvailability
                    providers={config.providers}
                    onChange={(providers) => setConfig({ ...config, providers })}
                  />
                  <div className="flex items-center justify-between border-t pt-4">
                    <div>
                      <p className="text-sm font-medium">Enabled</p>
                      <p className="text-xs text-muted-foreground">
                        Make this server available in the selected scope.
                      </p>
                    </div>
                    <Switch
                      aria-label="Enable MCP server"
                      checked={config.enabled}
                      onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
                    />
                  </div>
                </div>
              )}
            </fieldset>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {confirmDelete ? (
            <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
              <p className="text-sm">Delete {initialName} from this scope?</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || readOnly}
                  onClick={() =>
                    void run(async () => {
                      await onDelete?.();
                      onClose();
                    })
                  }
                >
                  Delete server
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {onReset && !importView ? (
            <Button
              variant="ghost"
              disabled={busy || readOnly}
              onClick={() =>
                void run(async () => {
                  await onReset();
                  onClose();
                })
              }
            >
              Use all-project settings
            </Button>
          ) : null}
          {onDelete && !importView ? (
            <Button
              variant="ghost"
              disabled={busy || readOnly}
              className="sm:mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon className="size-4" />
              Delete
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {!importView ? (
            <Button disabled={busy || readOnly} onClick={save}>
              {busy ? "Saving…" : initialName ? "Save changes" : "Add server"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
