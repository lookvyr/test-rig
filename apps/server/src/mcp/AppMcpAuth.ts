import {
  McpRuntimeError,
  type ListMcpRuntimeStatusesInput,
  type McpOAuthBeginInput,
  type McpOAuthCompleteInput,
  type McpOAuthServerInput,
} from "@t3tools/contracts";
import { resolveToolsScopeMcpServers } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerSettingsService } from "../serverSettings.ts";
import { ToolsProjectScopesService } from "../skills/ToolsProjectScopes.ts";
import { AppMcpOAuth } from "./AppMcpOAuth.ts";

const configuredServers = Effect.fn("AppMcpAuth.configuredServers")(
  function* (input: ListMcpRuntimeStatusesInput) {
    const settings = yield* (yield* ServerSettingsService).getSettings;
    const scope =
      input.projectId === undefined
        ? undefined
        : yield* (yield* ToolsProjectScopesService).resolve(input.projectId);
    return resolveToolsScopeMcpServers(
      settings,
      input.projectId ?? null,
      scope?.scopeId,
      scope?.projectIds,
    );
  },
  Effect.mapError(
    () =>
      new McpRuntimeError({
        operation: "oauth",
        message: "Could not read the MCP server configuration.",
      }),
  ),
);

const serverUrl = Effect.fn("AppMcpAuth.serverUrl")(function* (input: McpOAuthServerInput) {
  const servers = yield* configuredServers(input);
  const server = servers[input.serverName];
  if (server?.transport.type !== "http")
    return yield* new McpRuntimeError({
      operation: "oauth",
      message: "Sign-in requires a saved HTTP MCP server.",
    });
  return server.transport.url;
});

export const list = Effect.fn("AppMcpAuth.list")(function* (input: ListMcpRuntimeStatusesInput) {
  const servers = yield* configuredServers(input);
  const oauth = yield* AppMcpOAuth;
  const statuses = yield* Effect.forEach(
    Object.entries(servers).flatMap(([serverName, server]) =>
      server.transport.type === "http" &&
      (input.serverName === undefined || serverName === input.serverName)
        ? [{ serverName, url: server.transport.url }]
        : [],
    ),
    ({ serverName, url }) =>
      oauth.status(url).pipe(
        Effect.map((status) => ({
          serverName,
          projectId: input.projectId ?? null,
          state: status.state,
          error: null,
        })),
      ),
    { concurrency: 4 },
  );
  return { statuses };
});

export const begin = Effect.fn("AppMcpAuth.begin")(function* (input: McpOAuthBeginInput) {
  const url = yield* serverUrl(input);
  const oauth = yield* AppMcpOAuth;
  return yield* oauth.authenticate({ serverUrl: url, callbackUrl: input.callbackUrl });
});

export const signOut = Effect.fn("AppMcpAuth.signOut")(function* (input: McpOAuthServerInput) {
  const url = yield* serverUrl(input);
  yield* (yield* AppMcpOAuth).signOut(url);
});

const parseCallback = (callbackUrl: string) =>
  Effect.try({
    try: () => new URL(callbackUrl),
    catch: () =>
      new McpRuntimeError({
        operation: "oauth",
        message: "Enter the complete sign-in callback URL.",
      }),
  });

export const complete = Effect.fn("AppMcpAuth.complete")(function* (input: McpOAuthCompleteInput) {
  const url = yield* parseCallback(input.callbackUrl);
  if (url.searchParams.get("state") !== input.flowId)
    return yield* new McpRuntimeError({
      operation: "oauth",
      message: "This callback belongs to a different sign-in attempt.",
    });
  yield* (yield* AppMcpOAuth).complete({
    state: input.flowId,
    ...(url.searchParams.has("code") ? { code: url.searchParams.get("code")! } : {}),
    ...(url.searchParams.has("error") ? { error: url.searchParams.get("error")! } : {}),
  });
});

export const callbackLayer = Layer.unwrap(
  Effect.gen(function* () {
    const oauth = yield* AppMcpOAuth;
    return HttpRouter.add(
      "GET",
      "/oauth/mcp/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://localhost");
        const state = url.searchParams.get("state");
        if (!state) return HttpServerResponse.text("Missing MCP sign-in state.", { status: 400 });
        const result = yield* complete({ flowId: state, callbackUrl: url.href }).pipe(
          Effect.provideService(AppMcpOAuth, oauth),
          Effect.result,
        );
        return HttpServerResponse.text(
          result._tag === "Success"
            ? "MCP sign-in complete. You can close this tab and return to Test Rig."
            : result.failure.message,
          {
            status: result._tag === "Success" ? 200 : 400,
            headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
          },
        );
      }),
    );
  }),
);
