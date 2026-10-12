import type {
  McpServerConfig,
  McpServerVariable,
  McpServerProjectOverride,
  McpServers,
  ProjectSettingsOverrides,
  ProjectId,
  SkillLibraryAssignment,
  SkillLibraryDetail,
  ToolsScopeId,
} from "@t3tools/contracts";

export const EMPTY_SKILL_ASSIGNMENT: SkillLibraryAssignment = {
  allProjects: false,
  projectIds: [],
  disabledProjectIds: [],
};

export const MCP_STATUS_LABELS = {
  connected: "Connected",
  connecting: "Connecting",
  "needs-auth": "Sign in needed",
  failed: "Connection failed",
  disconnected: "Disconnected",
  disabled: "Off",
  unsupported: "Unavailable",
  unknown: "Not checked",
};

/** A completed write is authoritative while its invalidated read is still refreshing. */
export function skillEditorDetail(
  cached: SkillLibraryDetail | null,
  saved: SkillLibraryDetail | null,
  id: string | null,
): SkillLibraryDetail | null {
  if (!saved || saved.id !== id) return cached;
  return cached && cached.updatedAt > saved.updatedAt ? cached : saved;
}

export function assignmentIncludesScope(
  assignment: SkillLibraryAssignment,
  scopeId: ToolsScopeId,
  memberProjectIds: ReadonlyArray<ProjectId>,
) {
  if (assignment.disabledScopeIds?.includes(scopeId)) return false;
  if (assignment.scopeIds?.includes(scopeId)) return true;
  return (
    !memberProjectIds.some((id) => assignment.disabledProjectIds.includes(id)) &&
    (assignment.allProjects || memberProjectIds.some((id) => assignment.projectIds.includes(id)))
  );
}

export function toggleSkillScope(
  assignment: SkillLibraryAssignment,
  scopeId: ToolsScopeId,
  enabled: boolean,
  memberProjectIds: ReadonlyArray<ProjectId> = [],
): SkillLibraryAssignment {
  const members = new Set(memberProjectIds);
  return {
    ...assignment,
    projectIds: assignment.projectIds.filter((id) => !members.has(id)),
    disabledProjectIds: assignment.disabledProjectIds.filter((id) => !members.has(id)),
    scopeIds: enabled
      ? [...new Set([...(assignment.scopeIds ?? []), scopeId])]
      : (assignment.scopeIds ?? []).filter((id) => id !== scopeId),
    disabledScopeIds: enabled
      ? (assignment.disabledScopeIds ?? []).filter((id) => id !== scopeId)
      : [...new Set([...(assignment.disabledScopeIds ?? []), scopeId])],
  };
}

export function selectedSkillScopes(
  assignment: SkillLibraryAssignment,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
): ToolsScopeId[] {
  return projects
    .filter((project) => assignmentIncludesScope(assignment, project.id, project.memberProjectIds))
    .map((project) => project.id);
}

export function countAssignedSkillScopes(
  assignment: SkillLibraryAssignment,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
): number {
  const knownProjectIds = new Set(projects.flatMap((project) => project.memberProjectIds));
  const knownScopeIds = new Set(projects.map((project) => project.id));
  const availableScopes = selectedSkillScopes(assignment, projects);
  const unknownProjects = assignment.projectIds.filter(
    (id) => !knownProjectIds.has(id) && !assignment.disabledProjectIds.includes(id),
  );
  const unknownScopes = (assignment.scopeIds ?? []).filter(
    (id) => !knownScopeIds.has(id) && !assignment.disabledScopeIds?.includes(id),
  );
  return new Set([...availableScopes, ...unknownProjects, ...unknownScopes]).size;
}

export function setSelectedSkillScopes(
  assignment: SkillLibraryAssignment,
  scopeIds: ReadonlyArray<ToolsScopeId>,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
): SkillLibraryAssignment {
  const knownIds = new Set(projects.flatMap((project) => project.memberProjectIds));
  const knownScopes = new Set(projects.map((project) => project.id));
  return {
    ...assignment,
    projectIds: assignment.projectIds.filter((id) => !knownIds.has(id)),
    scopeIds: [...(assignment.scopeIds ?? []).filter((id) => !knownScopes.has(id)), ...scopeIds],
    disabledScopeIds: (assignment.disabledScopeIds ?? []).filter((id) => !scopeIds.includes(id)),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Paste a server configuration object.");
  return value as Record<string, unknown>;
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error(`${field} must be a JSON array of strings.`);
  return value;
}

function variables(value: unknown): McpServerVariable[] {
  if (value === undefined) return [];
  return Object.entries(object(value)).map(([name, item]) => {
    if (typeof item !== "string") throw new Error("Header and environment values must be strings.");
    return { name, value: item, sensitive: true };
  });
}

/** Accept common provider JSON wrappers while rejecting ambiguous imports. */
export function parseMcpServerJson(text: string): { name: string; config: McpServerConfig } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Enter valid JSON.");
  }
  let entry = object(input);
  for (const key of ["mcpServers", "servers", "mcp"]) {
    if (entry[key] !== undefined) {
      entry = object(entry[key]);
      break;
    }
  }
  let name = "";
  if (
    entry.command === undefined &&
    entry.url === undefined &&
    entry.serverUrl === undefined &&
    entry.httpUrl === undefined
  ) {
    const entries = Object.entries(entry);
    if (entries.length !== 1) throw new Error("Paste one server configuration at a time.");
    const first = entries[0]!;
    name = first[0];
    entry = object(first[1]);
  }
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl;
  const providers = ["codex", "claudeAgent", "opencode"] as const;
  if (url !== undefined) {
    if (typeof url !== "string") throw new Error("Server URL must be a string.");
    return {
      name,
      config: {
        enabled: entry.enabled !== false,
        providers,
        transport: { type: "http", url, headers: variables(entry.headers) },
      },
    };
  }
  const command =
    typeof entry.command === "string" ? [entry.command] : strings(entry.command, "Command");
  if (!command[0]) throw new Error("Add a command or server URL.");
  return {
    name,
    config: {
      enabled: entry.enabled !== false,
      providers,
      transport: {
        type: "stdio",
        command: command[0],
        args: [...command.slice(1), ...strings(entry.args, "Arguments")],
        env: variables(entry.env ?? entry.environment),
      },
    },
  };
}

/** Keep inherited connection and provider choices sparse when editing a project's availability. */
export function projectMcpServerSettings(
  global: McpServers,
  overrides: ProjectSettingsOverrides,
  oldName: string,
  name: string,
  config: McpServerConfig,
  remove = false,
): ProjectSettingsOverrides {
  const servers: Record<string, McpServerProjectOverride> = { ...overrides.mcpServers };
  if (oldName !== name || remove) delete servers[oldName];
  if (remove) return { ...overrides, mcpServers: servers };
  const inherited = global[oldName];
  const previous = overrides.mcpServers?.[oldName];
  const sameInheritedTransport =
    !previous?.transport &&
    inherited &&
    name === oldName &&
    JSON.stringify(inherited.transport) === JSON.stringify(config.transport);
  const vars = config.transport.type === "http" ? config.transport.headers : config.transport.env;
  if (
    !sameInheritedTransport &&
    !previous?.transport &&
    vars.some((variable) => variable.valueRedacted)
  )
    throw new Error(
      "Enter the saved secret values again to create a separate connection for this project. Availability changes can keep the inherited connection.",
    );
  if (oldName !== name && inherited) servers[oldName] = { enabled: false };
  const providersUnchanged =
    name === oldName &&
    !previous?.providers &&
    inherited &&
    JSON.stringify(inherited.providers) === JSON.stringify(config.providers);
  if (
    sameInheritedTransport &&
    !previous &&
    config.enabled === inherited.enabled &&
    providersUnchanged
  )
    return overrides;
  servers[name] = {
    enabled: config.enabled,
    ...(providersUnchanged ? {} : { providers: config.providers }),
    ...(sameInheritedTransport ? {} : { transport: config.transport }),
  };
  return { ...overrides, mcpServers: servers };
}

export type MarkdownTool = "bold" | "italic" | "heading" | "list" | "link" | "code";
export function insertMarkdown(text: string, start: number, end: number, tool: MarkdownTool) {
  const selected = text.slice(start, end);
  const formats = {
    bold: ["**", "**", "bold text"],
    italic: ["*", "*", "italic text"],
    heading: ["## ", "", "Heading"],
    list: ["- ", "", "List item"],
    link: ["[", "](https://example.com)", "link text"],
    code: ["```\n", "\n```", "code"],
  } as const;
  const [prefix, suffix, placeholder] = formats[tool];
  const linePrefix =
    (tool === "heading" || tool === "list" || tool === "code") &&
    start > 0 &&
    text[start - 1] !== "\n"
      ? "\n"
      : "";
  const body = selected || placeholder;
  return {
    text: text.slice(0, start) + linePrefix + prefix + body + suffix + text.slice(end),
    start: start + linePrefix.length + prefix.length,
    end: start + linePrefix.length + prefix.length + body.length,
  };
}
