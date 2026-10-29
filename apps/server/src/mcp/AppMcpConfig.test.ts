import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ResolvedMcpServer,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe } from "vite-plus/test";
import {
  appMcpProviderServers,
  appMcpRuntimeName,
  claudeAppMcpConfig,
  codexAppMcpConfig,
} from "./AppMcpConfig.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import {
  buildCodexTurnStartParams,
  codexThreadRuntimeParams,
  codexSkillMentionText,
} from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import {
  claudeMcpQueryOverrides,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { planClaudeSkillDispatch } from "../provider/Drivers/ClaudeSkillDispatch.ts";

const servers: ReadonlyArray<ResolvedMcpServer> = [
  {
    name: "github",
    transport: {
      type: "http",
      url: "https://mcp.example.test",
      headers: [{ name: "Authorization", value: "Bearer header-secret", sensitive: true }],
    },
  },
  {
    name: "local",
    transport: {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: [{ name: "API_TOKEN", value: "env-secret", sensitive: true }],
    },
  },
];
describe("app-owned provider MCP configuration", () => {
  it("uses independent stable keys for native same-name servers", () => {
    const config = codexAppMcpConfig(servers);
    assert.isUndefined(config.github);
    assert.deepEqual(config["tru-local"], {
      command: "node",
      args: ["server.js"],
      env: { API_TOKEN: "env-secret" },
    });
    assert.deepEqual(config["tru-github"], {
      url: "https://mcp.example.test",
      http_headers: { Authorization: "Bearer header-secret" },
    });
    assert.equal(appMcpRuntimeName("github"), appMcpRuntimeName("github"));
  });
  it("keeps Claude header and environment secrets out of MCP config argv, with collision-free references", () => {
    const result = claudeAppMcpConfig([
      ...servers,
      {
        name: "a-b",
        transport: {
          type: "http",
          url: "https://example.test",
          headers: [{ name: "Authorization", value: "first-secret", sensitive: true }],
        },
      },
      {
        name: "a_b",
        transport: {
          type: "http",
          url: "https://example.test",
          headers: [{ name: "Authorization", value: "second-secret", sensitive: true }],
        },
      },
    ]);
    for (const secret of ["header-secret", "env-secret", "first-secret", "second-secret"])
      assert.notInclude(JSON.stringify(result.configs), secret);
    assert.deepEqual(
      Object.values(result.environment).sort(),
      ["Bearer header-secret", "env-secret", "first-secret", "second-secret"].sort(),
    );
    assert.lengthOf(Object.keys(result.environment), 4);
  });
  it("injects app configuration alongside built-in tools using the live session snapshot", () => {
    const threadId = ThreadId.make("app-mcp-injection");
    McpProviderSession.setMcpProviderSession({
      environmentId: EnvironmentId.make("app-mcp-env"),
      threadId,
      providerSessionId: "app-mcp-credential",
      providerInstanceId: ProviderInstanceId.make("codex"),
      endpoint: "http://localhost/mcp",
      authorizationHeader: "Bearer builtin",
      browserToolsAvailable: false,
      appMcpServers: servers,
    });
    try {
      const codex = codexThreadRuntimeParams({ threadId });
      assert.deepEqual(codex.config.mcp_servers, {
        ...codexAppMcpConfig(
          appMcpProviderServers(McpProviderSession.readMcpProviderSession(threadId)!),
        ),
        test_rig: {
          url: "http://localhost/mcp",
          tool_timeout_sec: 65 * 60,
          http_headers: { Authorization: "Bearer builtin" },
        },
      });
      assert.notInclude(JSON.stringify(codex.config), "header-secret");
      assert.include(JSON.stringify(codex.config), "http://localhost/mcp/app/github");
      const claude = claudeMcpQueryOverrides({ threadId, readOnlySandbox: true });
      assert.isDefined(claude.mcpServers?.["tru-github"]);
      assert.isDefined(claude.mcpServers?.["tru-local"]);
      assert.notInclude(JSON.stringify(claude.mcpEnvironment), "header-secret");
      assert.include(JSON.stringify(claude.mcpServers), "http://localhost/mcp/app/github");
      assert.equal(McpProviderSession.readMcpProviderSession(threadId)?.appMcpServers, servers);
      assert.notInclude(claude.allowedTools ?? [], "mcp__tru-local__*");
    } finally {
      McpProviderSession.clearMcpProviderSession(threadId);
    }
  });
  it.effect("delivers catalogue instructions through Codex app context and Claude append", () =>
    Effect.gen(function* () {
      const catalogue = "Read /app/skills/id/SKILL.md when test-rig:id is requested.";
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
      const result = yield* buildCodexTurnStartParams({
        nativeThreadId: "native",
        codexInput: [],
        runtimePolicy: {
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace",
        },
        modelSelection,
        skillCatalogue: catalogue,
      });
      assert.equal(result.additionalContext?.test_rig_skill_library_01?.value, catalogue);
      assert.equal(result.additionalContext?.test_rig_skill_library_01?.kind, "application");
      const options = makeClaudeQueryOptions({
        modelSelection,
        nativeThreadId: "native",
        resume: false,
        cwd: "/workspace",
        skillCatalogue: catalogue,
      });
      assert.include(
        typeof options.systemPrompt === "object" &&
          !Array.isArray(options.systemPrompt) &&
          "append" in options.systemPrompt
          ? (options.systemPrompt.append ?? "")
          : "",
        catalogue,
      );
    }),
  );
  it("keeps library aliases out of native skill parsing and slash dispatch even on a name collision", () => {
    const alias = "test-rig:123";
    assert.equal(
      codexSkillMentionText(`$${alias} $review`),
      `[Test Rig library skill ${alias}] $review`,
    );
    assert.isUndefined(planClaudeSkillDispatch(`$${alias}`, new Set([alias])));
  });
});
