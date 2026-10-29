import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ToolsScopeId,
  type McpServerConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ServerSettingsService } from "../serverSettings.ts";
import { ToolsProjectScopesService } from "../skills/ToolsProjectScopes.ts";
import * as AppMcpAuth from "./AppMcpAuth.ts";
import { AppMcpOAuth, type AppMcpOAuthShape } from "./AppMcpOAuth.ts";

const mainProject = ProjectId.make("main");
const worktreeProject = ProjectId.make("worktree");
const scopeId = ToolsScopeId.make(`git:${"a".repeat(64)}`);
const callbackUrl = "https://remote.example.test/oauth/mcp/callback";
const httpServer = (url: string): McpServerConfig => ({
  enabled: true,
  providers: ["codex", "claudeAgent"],
  transport: { type: "http", url, headers: [] },
});
const settings: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  mcpServers: {
    inherited: httpServer("https://inherited.example.test/mcp"),
    overridden: httpServer("https://global.example.test/mcp"),
    local: {
      enabled: true,
      providers: ["codex"],
      transport: { type: "stdio", command: "node", args: [], env: [] },
    },
  },
  projectSettingsOverrides: {
    [mainProject]: {
      mcpServers: {
        legacy: {
          enabled: true,
          transport: httpServer("https://legacy.example.test/mcp").transport,
        },
      },
    },
  },
  toolsScopeMcpServers: {
    [scopeId]: {
      overridden: {
        enabled: true,
        transport: httpServer("https://repository.example.test/mcp").transport,
      },
    },
  },
};

function fixture() {
  const statusUrls: string[] = [];
  const authentications: Array<Parameters<AppMcpOAuthShape["authenticate"]>[0]> = [];
  const completions: Array<Parameters<AppMcpOAuthShape["complete"]>[0]> = [];
  const signOutUrls: string[] = [];
  const resolvedProjects: ProjectId[] = [];
  const oauth = AppMcpOAuth.of({
    status: (url) =>
      Effect.sync(() => {
        statusUrls.push(url);
        return { state: "signed-in" as const, expiresAt: null, authenticationRequired: true };
      }),
    authenticate: (input) =>
      Effect.sync(() => {
        authentications.push(input);
        return { flowId: "flow-one", authorizationUrl: "https://auth.example.test/authorize" };
      }),
    complete: (input) =>
      Effect.sync(() => {
        completions.push(input);
      }),
    signOut: (url) =>
      Effect.sync(() => {
        signOutUrls.push(url);
      }),
    accessToken: () => Effect.die("unused"),
    markExpired: () => Effect.die("unused"),
  });
  const layer = Layer.mergeAll(
    Layer.succeed(AppMcpOAuth, oauth),
    Layer.succeed(ServerSettingsService, {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.succeed(settings),
      updateSettings: () => Effect.die("unused"),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.succeed(Stream.empty),
    }),
    Layer.succeed(ToolsProjectScopesService, {
      list: () => Effect.die("unused"),
      resolve: (projectId) =>
        Effect.sync(() => {
          resolvedProjects.push(projectId);
          return { scopeId, projectIds: [mainProject, worktreeProject] };
        }),
    }),
  );
  return { layer, statusUrls, authentications, completions, signOutUrls, resolvedProjects };
}

it.effect(
  "lists saved HTTP authentication without provider sessions and keeps global settings separate",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      const result = yield* AppMcpAuth.list({}).pipe(Effect.provide(test.layer));
      assert.deepEqual(result.statuses, [
        { serverName: "inherited", projectId: null, state: "signed-in", error: null },
        { serverName: "overridden", projectId: null, state: "signed-in", error: null },
      ]);
      assert.deepEqual(test.statusUrls, [
        "https://inherited.example.test/mcp",
        "https://global.example.test/mcp",
      ]);
      assert.deepEqual(test.resolvedProjects, []);
    }),
);

it.effect("resolves inherited, repository and legacy settings equally from linked worktrees", () =>
  Effect.gen(function* () {
    const test = fixture();
    for (const projectId of [mainProject, worktreeProject]) {
      const result = yield* AppMcpAuth.list({ projectId }).pipe(Effect.provide(test.layer));
      assert.deepEqual(
        result.statuses.map((status) => [status.serverName, status.projectId]),
        [
          ["inherited", projectId],
          ["overridden", projectId],
          ["legacy", projectId],
        ],
      );
    }
    assert.deepEqual(test.statusUrls, [
      "https://inherited.example.test/mcp",
      "https://repository.example.test/mcp",
      "https://legacy.example.test/mcp",
      "https://inherited.example.test/mcp",
      "https://repository.example.test/mcp",
      "https://legacy.example.test/mcp",
    ]);
    assert.deepEqual(test.resolvedProjects, [mainProject, worktreeProject]);
  }),
);

it.effect("filters status by saved server name before consulting OAuth", () =>
  Effect.gen(function* () {
    const test = fixture();
    const result = yield* AppMcpAuth.list({
      serverName: "overridden",
      projectId: worktreeProject,
    }).pipe(Effect.provide(test.layer));
    assert.lengthOf(result.statuses, 1);
    assert.deepEqual(test.statusUrls, ["https://repository.example.test/mcp"]);
  }),
);

it.effect(
  "begins authorization against the effective configured URL and rejects unsaved or stdio servers",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      const input = {
        serverName: "overridden",
        projectId: worktreeProject,
        callbackUrl,
        serverUrl: "https://unconfigured.example.test/mcp",
      };
      const result = yield* AppMcpAuth.begin(input).pipe(Effect.provide(test.layer));
      assert.deepEqual(result, {
        flowId: "flow-one",
        authorizationUrl: "https://auth.example.test/authorize",
      });
      assert.deepEqual(test.authentications, [
        { serverUrl: "https://repository.example.test/mcp", callbackUrl },
      ]);
      for (const serverName of ["missing", "local"]) {
        const failure = yield* AppMcpAuth.begin({ serverName, callbackUrl }).pipe(
          Effect.provide(test.layer),
          Effect.result,
        );
        assert.equal(failure._tag, "Failure");
        if (failure._tag === "Failure")
          assert.equal(failure.failure.message, "Sign-in requires a saved HTTP MCP server.");
      }
      assert.lengthOf(test.authentications, 1);
    }),
);

it.effect("rejects malformed or mismatched forwarded callbacks before calling OAuth", () =>
  Effect.gen(function* () {
    const test = fixture();
    for (const callbackUrl of [
      "not a URL",
      "https://remote.example.test/oauth/mcp/callback?state=another&code=secret",
    ]) {
      const result = yield* AppMcpAuth.complete({ flowId: "flow-one", callbackUrl }).pipe(
        Effect.provide(test.layer),
        Effect.result,
      );
      assert.equal(result._tag, "Failure");
    }
    assert.deepEqual(test.completions, []);
  }),
);

it.effect(
  "forwards a validated remote-browser callback and provider denial to the OAuth core",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      yield* AppMcpAuth.complete({
        flowId: "flow-one",
        callbackUrl: `${callbackUrl}?state=flow-one&code=remote%20code`,
      }).pipe(Effect.provide(test.layer));
      yield* AppMcpAuth.complete({
        flowId: "flow-two",
        callbackUrl: `${callbackUrl}?state=flow-two&error=access_denied`,
      }).pipe(Effect.provide(test.layer));
      assert.deepEqual(test.completions, [
        { state: "flow-one", code: "remote code" },
        { state: "flow-two", error: "access_denied" },
      ]);
    }),
);

it.effect("signs out the configured global or worktree URL", () =>
  Effect.gen(function* () {
    const test = fixture();
    yield* AppMcpAuth.signOut({ serverName: "overridden" }).pipe(Effect.provide(test.layer));
    yield* AppMcpAuth.signOut({ serverName: "overridden", projectId: worktreeProject }).pipe(
      Effect.provide(test.layer),
    );
    assert.deepEqual(test.signOutUrls, [
      "https://global.example.test/mcp",
      "https://repository.example.test/mcp",
    ]);
  }),
);
