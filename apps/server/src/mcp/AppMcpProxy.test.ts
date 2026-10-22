import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { AppMcpOAuth } from "./AppMcpOAuth.ts";
import { handleRequest } from "./AppMcpProxy.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import type { McpCapability } from "./McpInvocationContext.ts";

const threadId = ThreadId.make("proxy-thread");
const session = {
  environmentId: EnvironmentId.make("proxy-environment"),
  threadId,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: "proxy-session",
  endpoint: "http://localhost/mcp",
  authorizationHeader: "Bearer local-only",
  browserToolsAvailable: false,
  appMcpServers: [
    {
      name: "remote",
      transport: {
        type: "http" as const,
        url: "https://upstream.example.test/mcp?configured=true",
        headers: [{ name: "X-Configured", value: "server-secret", sensitive: true }],
      },
    },
  ],
};
const scope = {
  ...session,
  capabilities: new Set<McpCapability>(),
  issuedAt: 0,
};

const harness = (
  input: {
    method?: "GET" | "POST" | "DELETE";
    token?: string;
    name?: string;
    stale?: boolean;
    authorization?: string;
    tokens?: ReadonlyArray<string | null>;
    respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
  } = {},
) =>
  Effect.gen(function* () {
    const current =
      input.authorization === undefined
        ? session
        : {
            ...session,
            appMcpServers: session.appMcpServers.map((server) => ({
              ...server,
              transport: {
                ...server.transport,
                headers: [
                  ...server.transport.headers,
                  { name: "aUtHoRiZaTiOn", value: input.authorization!, sensitive: true },
                ],
              },
            })),
          };
    McpProviderSession.setMcpProviderSession(
      input.stale ? { ...current, providerSessionId: "replacement" } : current,
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
    );
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const refresh: Array<boolean> = [];
    const expired: Array<string> = [];
    const signals: Array<AbortSignal> = [];
    const method = input.method ?? "POST";
    const response = yield* handleRequest(input.name ?? "remote").pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request("http://localhost/mcp/app/remote?url=https://attacker.test", {
            method,
            headers: {
              authorization: `Bearer ${input.token ?? "local-only"}`,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-session-id": "upstream-session",
              "mcp-protocol-version": "2025-06-18",
              "last-event-id": "last-event",
              cookie: "local-cookie=secret",
            },
            ...(method === "POST"
              ? { body: '{"jsonrpc":"2.0","method":"tools/list","id":1}' }
              : {}),
          }),
        ),
      ),
      Effect.provideService(
        McpSessionRegistry,
        McpSessionRegistry.of({
          resolve: (token) => Effect.succeed(token === "local-only" ? scope : undefined),
          issue: () => Effect.die("unused"),
          touch: () => Effect.void,
          revokeProviderSession: () => Effect.void,
          revokeThread: () => Effect.void,
          revokeAll: Effect.void,
        }),
      ),
      Effect.provideService(
        AppMcpOAuth,
        AppMcpOAuth.of({
          status: () => Effect.die("unused"),
          authenticate: () => Effect.die("unused"),
          complete: () => Effect.die("unused"),
          signOut: () => Effect.void,
          markExpired: (url) =>
            Effect.sync(() => {
              expired.push(url);
            }),
          accessToken: (_, options) =>
            Effect.sync(() => {
              refresh.push(options?.forceRefresh ?? false);
              return input.tokens?.[refresh.length - 1] ?? null;
            }),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request, _, signal) => {
          requests.push(request);
          signals.push(signal);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              input.respond?.(request) ??
                new Response("event: message\ndata: {}\n\n", {
                  headers: {
                    "content-type": "text/event-stream",
                    "mcp-session-id": "new-upstream-session",
                    "set-cookie": "upstream-cookie=secret",
                    "www-authenticate": "Bearer resource_metadata=https://upstream.example.test",
                  },
                }),
            ),
          );
        }),
      ),
    );
    return { response: HttpServerResponse.toWeb(response), requests, refresh, expired, signals };
  });

it.effect(
  "forwards MCP bytes and session headers while retaining OAuth and configured secrets on the server",
  () =>
    Effect.gen(function* () {
      const result = yield* harness({ tokens: ["upstream-token"] });
      expect(result.requests).toHaveLength(1);
      const request = result.requests[0]!;
      expect(request.url).toBe(session.appMcpServers[0]!.transport.url);
      expect(request.headers.authorization).toBe("Bearer upstream-token");
      expect(request.headers["x-configured"]).toBe("server-secret");
      expect(request.headers["mcp-session-id"]).toBe("upstream-session");
      expect(request.headers["last-event-id"]).toBe("last-event");
      expect(request.headers.cookie).toBeUndefined();
      expect(request.body._tag).toBe("Uint8Array");
      if (request.body._tag === "Uint8Array")
        expect(new TextDecoder().decode(request.body.body)).toContain('"method":"tools/list"');
      expect(result.response.headers.get("mcp-session-id")).toBe("new-upstream-session");
      expect(result.response.headers.get("set-cookie")).toBeNull();
      expect(result.response.headers.get("www-authenticate")).toBeNull();
      expect(result.signals[0]!.aborted).toBe(false);
      expect(yield* Effect.promise(() => result.response.text())).toBe(
        "event: message\ndata: {}\n\n",
      );
      expect(result.signals[0]!.aborted).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect("rejects invalid, stale and out-of-snapshot access before contacting upstream", () =>
  Effect.gen(function* () {
    for (const options of [{ token: "invalid" }, { stale: true }, { name: "other" }]) {
      const result = yield* harness(options);
      expect(result.response.status).toBe(options.name ? 404 : 401);
      expect(result.requests).toHaveLength(0);
    }
  }).pipe(Effect.scoped),
);

it.effect("retries rejected OAuth once and suppresses provider-native OAuth discovery", () =>
  Effect.gen(function* () {
    const result = yield* harness({
      tokens: ["first", "refreshed"],
      respond: () =>
        new Response(new ReadableStream(), {
          status: 401,
          headers: { "www-authenticate": "Bearer" },
        }),
    });
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer first",
      "Bearer refreshed",
    ]);
    expect(result.refresh).toEqual([false, true]);
    expect(result.expired).toEqual([session.appMcpServers[0]!.transport.url]);
    expect(result.signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get("www-authenticate")).toBeNull();
    expect(yield* Effect.promise(() => result.response.text())).toContain("Sign in");
  }).pipe(Effect.scoped),
);

it.effect(
  "uses current shared credentials for GET and DELETE and supports static headers without OAuth",
  () =>
    Effect.gen(function* () {
      for (const method of ["GET", "DELETE"] as const) {
        const result = yield* harness({
          method,
          respond: () => new Response(null, { status: 204 }),
        });
        expect(result.requests[0]!.method).toBe(method);
        expect(result.requests[0]!.headers.authorization).toBeUndefined();
        expect(result.requests[0]!.headers["x-configured"]).toBe("server-secret");
        expect(result.response.status).toBe(204);
      }
    }).pipe(Effect.scoped),
);

it.effect(
  "preserves explicit Authorization headers without consulting or mutating shared OAuth",
  () =>
    Effect.gen(function* () {
      for (const status of [200, 401]) {
        const result = yield* harness({
          authorization: "Bearer explicit-token",
          tokens: ["unrelated-shared-token"],
          respond: () => new Response("response", { status }),
        });
        expect(result.requests).toHaveLength(1);
        expect(result.requests[0]!.headers.authorization).toBe("Bearer explicit-token");
        expect(result.refresh).toEqual([]);
        expect(result.expired).toEqual([]);
        expect(result.response.status).toBe(status === 401 ? 403 : status);
      }
    }).pipe(Effect.scoped),
);
