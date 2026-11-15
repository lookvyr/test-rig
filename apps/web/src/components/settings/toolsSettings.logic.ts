import {
  ALL_PROJECTS_TOOLS_ASSIGNMENT,
  isToolsAssignmentAvailable,
  type McpServerConfig,
  type McpServerVariable,
  type ProjectId,
  type SkillLibraryAssignment,
  type SkillLibraryDetail,
  type ToolsScopeId,
} from "@t3tools/contracts";

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
  return isToolsAssignmentAvailable(assignment, scopeId, memberProjectIds);
}

export function selectedSkillScopes(
  assignment: SkillLibraryAssignment,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
): ToolsScopeId[] {
  return projects
    .filter((project) => assignmentIncludesScope(assignment, project.id, project.memberProjectIds))
    .map((project) => project.id);
}

/** "All" when every listed project is in and new ones join; otherwise "3 of 7". */
export function assignmentSummary(
  assignment: SkillLibraryAssignment,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
): string {
  const count = selectedSkillScopes(assignment, projects).length;
  return assignment.allProjects && count === projects.length
    ? "All"
    : `${count} of ${projects.length}`;
}

/**
 * Replace the choices for the listed projects. With `includeNew`, every
 * project is in unless unchecked, so projects added later join; without it,
 * only the checked ones. Choices about projects not listed (an unavailable
 * workspace) are left alone.
 */
export function assignScopes(
  assignment: SkillLibraryAssignment,
  selected: ReadonlyArray<ToolsScopeId>,
  includeNew: boolean,
  projects: ReadonlyArray<{ id: ToolsScopeId; memberProjectIds: readonly ProjectId[] }>,
  unavailableProjectIds: ReadonlyArray<ProjectId> = [],
): SkillLibraryAssignment {
  const knownScopes = new Set<string>(projects.map((project) => project.id));
  const knownMembers = new Set<string>(projects.flatMap((project) => project.memberProjectIds));
  const unknownScopes = (ids: ReadonlyArray<ToolsScopeId> | undefined) =>
    (ids ?? []).filter((id) => !knownScopes.has(id));
  const unknownMembers = (ids: ReadonlyArray<ProjectId>) =>
    ids.filter((id) => !knownMembers.has(id));
  if (includeNew)
    return {
      allProjects: true,
      projectIds: [],
      disabledProjectIds: unknownMembers(assignment.disabledProjectIds),
      scopeIds: [],
      disabledScopeIds: [
        ...unknownScopes(assignment.disabledScopeIds),
        ...projects
          .filter((project) => !selected.includes(project.id))
          .map((project) => project.id),
      ],
    };
  // Leaving "every project" keeps the access an unavailable workspace already had.
  const keptUnavailable = assignment.allProjects
    ? unavailableProjectIds.filter((id) => !assignment.disabledProjectIds.includes(id))
    : [];
  return {
    allProjects: false,
    projectIds: [...new Set([...unknownMembers(assignment.projectIds), ...keptUnavailable])],
    disabledProjectIds: unknownMembers(assignment.disabledProjectIds),
    scopeIds: [...unknownScopes(assignment.scopeIds), ...selected],
    disabledScopeIds: [],
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
  const providers = ["codex", "claudeAgent"] as const;
  const assignment = ALL_PROJECTS_TOOLS_ASSIGNMENT;
  if (url !== undefined) {
    if (typeof url !== "string") throw new Error("Server URL must be a string.");
    return {
      name,
      config: {
        enabled: entry.enabled !== false,
        providers,
        assignment,
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
      assignment,
      transport: {
        type: "stdio",
        command: command[0],
        args: [...command.slice(1), ...strings(entry.args, "Arguments")],
        env: variables(entry.env ?? entry.environment),
      },
    },
  };
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
