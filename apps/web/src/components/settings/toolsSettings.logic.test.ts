import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ToolsScopeId, type SkillLibraryDetail } from "@t3tools/contracts";
import {
  insertMarkdown,
  parseMcpServerJson,
  projectMcpServerSettings,
  skillEditorDetail,
  assignmentIncludesScope,
  selectedSkillScopes,
  setSelectedSkillScopes,
  toggleSkillScope,
  countAssignedSkillScopes,
} from "./toolsSettings.logic";

describe("shared repository availability", () => {
  const first = ProjectId.make("main"),
    second = ProjectId.make("worktree");
  const scope = ToolsScopeId.make(`git:${"a".repeat(64)}`);
  const projects = [{ id: scope, memberProjectIds: [first, second] }];
  it("keeps one assigned project after a known member is removed from the project list", () => {
    const assignment = { allProjects: false, projectIds: [first], disabledProjectIds: [] };
    const enabled = toggleSkillScope(assignment, scope, true, [first, second]);
    expect(enabled.projectIds).toEqual([]);
    expect(countAssignedSkillScopes(enabled, [{ id: scope, memberProjectIds: [second] }])).toBe(1);
  });
  it("canonicalizes known members while preserving unrelated legacy assignments", () => {
    const unknown = ProjectId.make("unavailable-project");
    const assignment = {
      allProjects: true,
      projectIds: [first, unknown],
      disabledProjectIds: [second, unknown],
    };
    const enabled = toggleSkillScope(assignment, scope, true, [first, second]);
    expect(enabled.projectIds).toEqual([unknown]);
    expect(enabled.disabledProjectIds).toEqual([unknown]);
    expect(assignmentIncludesScope(enabled, scope, [second])).toBe(true);
  });
  it("counts a repository once after a legacy assignment is toggled off and on", () => {
    const assignment = { allProjects: false, projectIds: [first, second], disabledProjectIds: [] };
    expect(countAssignedSkillScopes(assignment, projects)).toBe(1);
    const disabled = toggleSkillScope(assignment, scope, false);
    expect(countAssignedSkillScopes(disabled, projects)).toBe(0);
    expect(countAssignedSkillScopes(toggleSkillScope(disabled, scope, true), projects)).toBe(1);
  });
  it("retains unknown assignments in the count without counting disabled entries", () => {
    const unknown = ToolsScopeId.make(`git:${"c".repeat(64)}`);
    const assignment = {
      allProjects: false,
      projectIds: [first, second, ProjectId.make("unknown")],
      disabledProjectIds: [],
      scopeIds: [scope, unknown],
      disabledScopeIds: [unknown],
    };
    expect(countAssignedSkillScopes(assignment, projects)).toBe(2);
  });
  it("shows legacy selected workspaces as one project and writes one durable scope", () => {
    const assignment = { allProjects: false, projectIds: [first], disabledProjectIds: [] };
    expect(selectedSkillScopes(assignment, projects)).toEqual([scope]);
    const changed = setSelectedSkillScopes(assignment, [scope], projects);
    expect(changed.projectIds).toEqual([]);
    expect(changed.scopeIds).toEqual([scope]);
    expect(assignmentIncludesScope(changed, scope, [ProjectId.make("future-worktree")])).toBe(true);
    expect(
      assignmentIncludesScope(toggleSkillScope(changed, scope, false), scope, [first, second]),
    ).toBe(false);
  });
  it("preserves legacy global exclusions until an explicit repository choice changes them", () => {
    const assignment = { allProjects: true, projectIds: [], disabledProjectIds: [first] };
    expect(assignmentIncludesScope(assignment, scope, [first, second])).toBe(false);
    expect(
      assignmentIncludesScope(toggleSkillScope(assignment, scope, true), scope, [first, second]),
    ).toBe(true);
  });
  it("preserves an unavailable repository scope when editing another checkbox", () => {
    const unknown = ToolsScopeId.make(`git:${"b".repeat(64)}`);
    const assignment = {
      allProjects: false,
      projectIds: [],
      disabledProjectIds: [],
      scopeIds: [unknown],
    };
    expect(setSelectedSkillScopes(assignment, [scope], projects).scopeIds).toEqual([
      unknown,
      scope,
    ]);
  });
});

describe("skill editor freshness after a project switch", () => {
  const one = ProjectId.make("one"),
    two = ProjectId.make("two");
  const cached: SkillLibraryDetail = {
    id: "12345678-1234-4234-8234-123456789abc",
    name: "example",
    description: "Example",
    instructions: "Instructions",
    providers: ["codex"],
    assignment: { allProjects: false, projectIds: [one, two], disabledProjectIds: [] },
    path: "/library/example/SKILL.md",
    supportingFiles: [],
    createdAt: "2026-10-11T18:00:00.000Z",
    updatedAt: "2026-10-11T18:00:00.000Z",
  };
  const saved = {
    ...cached,
    assignment: { ...cached.assignment, projectIds: [two] },
    updatedAt: "2026-10-11T18:00:01.000Z",
  };
  it("opens with the canonical assignment while the cached read is stale", () => {
    expect(skillEditorDetail(cached, saved, cached.id)?.assignment.projectIds).toEqual([two]);
    expect(skillEditorDetail(null, saved, cached.id)).toBe(saved);
  });
  it("allows a newer read and never substitutes a different skill", () => {
    const newer = { ...cached, updatedAt: "2026-10-11T18:00:02.000Z" };
    expect(skillEditorDetail(newer, saved, cached.id)).toBe(newer);
    expect(skillEditorDetail(cached, { ...saved, id: "different" }, cached.id)).toBe(cached);
  });
});

describe("MCP JSON import", () => {
  it("imports HTTP headers without changing secret text", () => {
    const result = parseMcpServerJson(
      JSON.stringify({
        mcpServers: {
          example: { url: "https://example.com/mcp", headers: { Authorization: "Bearer abc xyz" } },
        },
      }),
    );
    expect(result.name).toBe("example");
    expect(result.config.transport).toEqual({
      type: "http",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer abc xyz", sensitive: true }],
    });
  });
  it("preserves command-array arguments and paths containing spaces", () => {
    expect(
      parseMcpServerJson(
        JSON.stringify({
          mcp: {
            docs: {
              command: ["node", "/Users/me/My Tools/server.js"],
              args: ["--title", "two words"],
              environment: { TOKEN: "value" },
            },
          },
        }),
      ).config.transport,
    ).toEqual({
      type: "stdio",
      command: "node",
      args: ["/Users/me/My Tools/server.js", "--title", "two words"],
      env: [{ name: "TOKEN", value: "value", sensitive: true }],
    });
  });
  it("accepts a single bare configuration", () => {
    expect(parseMcpServerJson('{"command":"npx","args":["-y","server"]}').name).toBe("");
  });
  it("rejects ambiguous and malformed input rather than silently dropping fields", () => {
    expect(() => parseMcpServerJson("{")).toThrow("valid JSON");
    expect(() =>
      parseMcpServerJson('{"mcpServers":{"one":{"command":"a"},"two":{"command":"b"}}}'),
    ).toThrow("one server");
    expect(() => parseMcpServerJson('{"command":"npx","args":"-y server"}')).toThrow(
      "array of strings",
    );
    expect(() => parseMcpServerJson('{"url":"https://example.com","headers":{"Auth":42}}')).toThrow(
      "must be strings",
    );
    expect(() => parseMcpServerJson("null")).toThrow("object");
  });
});

describe("Markdown toolbar insertion", () => {
  it("keeps surrounding source and selects only the formatted text", () => {
    const result = insertMarkdown("before words after", 7, 12, "bold");
    expect(result.text).toBe("before **words** after");
    expect(result.text.slice(result.start, result.end)).toBe("words");
  });
  it("places a block on a new line and selects its editable placeholder", () => {
    const result = insertMarkdown("before", 6, 6, "code");
    expect(result.text).toBe("before\n```\ncode\n```");
    expect(result.text.slice(result.start, result.end)).toBe("code");
  });
});

describe("MCP project edits", () => {
  const config = {
    enabled: true,
    providers: ["codex", "claudeAgent", "opencode"] as const,
    transport: { type: "http" as const, url: "https://example.com/mcp", headers: [] },
  };
  it("keeps provider inheritance when changing only project enabled state", () => {
    expect(
      projectMcpServerSettings({ docs: config }, {}, "docs", "docs", { ...config, enabled: false }),
    ).toEqual({ mcpServers: { docs: { enabled: false } } });
    expect(projectMcpServerSettings({ docs: config }, {}, "docs", "docs", config)).toEqual({});
  });
  it("disables the old inherited name when renaming a project server", () => {
    expect(projectMcpServerSettings({ docs: config }, {}, "docs", "renamed", config)).toEqual({
      mcpServers: {
        docs: { enabled: false },
        renamed: { enabled: true, providers: config.providers, transport: config.transport },
      },
    });
  });
  it("preserves a provider subset when renaming instead of enabling other providers", () => {
    const limited = { ...config, providers: ["codex"] as const };
    expect(
      projectMcpServerSettings({ docs: limited }, {}, "docs", "renamed", limited).mcpServers
        ?.renamed?.providers,
    ).toEqual(["codex"]);
  });
  it("requires reentry before copying an inherited connection's saved secret", () => {
    const secretConfig = {
      ...config,
      transport: {
        ...config.transport,
        headers: [{ name: "Authorization", value: "", valueRedacted: true, sensitive: true }],
      },
    };
    expect(() =>
      projectMcpServerSettings({ docs: secretConfig }, {}, "docs", "docs", {
        ...secretConfig,
        transport: { ...secretConfig.transport, url: "https://new.example/mcp" },
      }),
    ).toThrow("saved secret values again");
    expect(
      projectMcpServerSettings({ docs: secretConfig }, {}, "docs", "docs", {
        ...secretConfig,
        enabled: false,
      }),
    ).toEqual({ mcpServers: { docs: { enabled: false } } });
  });
  it("removes only the chosen project override when resetting inheritance", () => {
    const overrides = {
      mcpServers: { docs: { enabled: false }, other: config },
      branchNamePrefix: "keep",
    };
    expect(
      projectMcpServerSettings({ docs: config }, overrides, "docs", "docs", config, true),
    ).toEqual({ ...overrides, mcpServers: { other: config } });
  });
});
