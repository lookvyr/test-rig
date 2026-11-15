import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ToolsScopeId, type SkillLibraryDetail } from "@t3tools/contracts";
import {
  insertMarkdown,
  parseMcpServerJson,
  skillEditorDetail,
  assignmentIncludesScope,
  assignmentSummary,
  assignScopes,
  selectedSkillScopes,
} from "./toolsSettings.logic";

describe("project assignment", () => {
  const first = ProjectId.make("main"),
    second = ProjectId.make("worktree");
  const scope = ToolsScopeId.make(`git:${"a".repeat(64)}`);
  const other = ToolsScopeId.make(`git:${"b".repeat(64)}`);
  const unavailable = ToolsScopeId.make(`git:${"c".repeat(64)}`);
  const projects = [
    { id: scope, memberProjectIds: [first, second] },
    { id: other, memberProjectIds: [ProjectId.make("other")] },
  ];
  const none = { allProjects: false, projectIds: [], disabledProjectIds: [] };

  it("shows a legacy selected workspace as its whole repository", () => {
    const legacy = { ...none, projectIds: [first] };
    expect(selectedSkillScopes(legacy, projects)).toEqual([scope]);
    expect(assignmentSummary(legacy, projects)).toBe("1 of 2");
  });

  it("summarizes every project with new ones joining as All", () => {
    const all = { allProjects: true, projectIds: [], disabledProjectIds: [] };
    expect(assignmentSummary(all, projects)).toBe("All");
    expect(assignmentSummary(assignScopes(all, [scope], true, projects), projects)).toBe("1 of 2");
    expect(assignmentSummary(assignScopes(all, [scope, other], false, projects), projects)).toBe(
      "2 of 2",
    );
  });

  it("includes projects added later only with new projects on", () => {
    const future = ToolsScopeId.make(`git:${"d".repeat(64)}`);
    const withNew = assignScopes(none, [scope], true, projects);
    expect(assignmentIncludesScope(withNew, future, [])).toBe(true);
    expect(assignmentIncludesScope(withNew, other, [])).toBe(false);
    const picked = assignScopes(withNew, [scope], false, projects);
    expect(assignmentIncludesScope(picked, future, [])).toBe(false);
    expect(assignmentIncludesScope(picked, scope, [ProjectId.make("new-worktree")])).toBe(true);
  });

  it("replaces legacy member choices for listed projects and keeps unavailable ones", () => {
    const gone = ProjectId.make("gone");
    const legacy = {
      allProjects: true,
      projectIds: [],
      disabledProjectIds: [first, gone],
      disabledScopeIds: [unavailable],
    };
    const changed = assignScopes(legacy, [scope, other], true, projects);
    expect(changed.disabledProjectIds).toEqual([gone]);
    expect(changed.disabledScopeIds).toEqual([unavailable]);
    expect(assignmentIncludesScope(changed, scope, [first, second])).toBe(true);
    const picked = assignScopes({ ...none, scopeIds: [unavailable] }, [other], false, projects);
    expect(picked.scopeIds).toEqual([unavailable, other]);
  });

  it("keeps an unavailable workspace's access when new projects are turned off", () => {
    const missing = ProjectId.make("missing-workspace");
    const excluded = ProjectId.make("excluded-workspace");
    const all = { allProjects: true, projectIds: [], disabledProjectIds: [excluded] };
    const picked = assignScopes(all, [scope], false, projects, [missing, excluded]);
    expect(picked.projectIds).toEqual([missing]);
    expect(assignmentIncludesScope(picked, unavailable, [missing])).toBe(true);
    expect(assignmentIncludesScope(picked, unavailable, [excluded])).toBe(false);
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
    enabled: true,
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
