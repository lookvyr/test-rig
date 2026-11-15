import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { McpServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import {
  loadMcpToolHistory,
  rememberMcpTools,
  rememberedMcpTools,
  resetMcpToolHistory,
  saveMcpToolHistory,
} from "./McpToolHistory.ts";

const http = (url: string) => ({ type: "http" as const, url, headers: [] });
const server = (url: string): McpServerConfig => ({
  providers: ["codex", "claudeAgent"],
  enabled: true,
  assignment: { allProjects: true, projectIds: [], disabledProjectIds: [] },
  transport: http(url),
});
const tools = [{ name: "get_issue", description: null }];

it("drops a list once its server points somewhere else", () => {
  resetMcpToolHistory();
  rememberMcpTools("github", http("https://one.test/mcp"), tools);
  assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {
    github: tools,
  });
  assert.deepEqual(rememberedMcpTools({ github: server("https://two.test/mcp") }), {});
  assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {});
});

it("ignores a session still running an older target", () => {
  resetMcpToolHistory();
  rememberMcpTools("github", http("https://old.test/mcp"), tools);
  assert.deepEqual(rememberedMcpTools({ github: server("https://new.test/mcp") }), {});
});

it("keeps a list while its server is missing from settings", () => {
  resetMcpToolHistory();
  rememberMcpTools("github", http("https://one.test/mcp"), tools);
  assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {
    github: tools,
  });
  assert.deepEqual(rememberedMcpTools({}), {});
  assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {
    github: tools,
  });
});

it.effect("saves the history and reads it back after a restart", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped();
    resetMcpToolHistory();
    yield* loadMcpToolHistory(stateDir);
    rememberMcpTools("github", http("https://one.test/mcp"), tools);
    rememberedMcpTools({ github: server("https://one.test/mcp") });
    yield* saveMcpToolHistory(stateDir);
    resetMcpToolHistory();
    assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {});
    yield* loadMcpToolHistory(stateDir);
    assert.deepEqual(rememberedMcpTools({ github: server("https://one.test/mcp") }), {
      github: tools,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
