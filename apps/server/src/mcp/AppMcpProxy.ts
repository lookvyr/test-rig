import { mcpServerVariableRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { AppMcpOAuth } from "./AppMcpOAuth.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";

const requestHeaders = [
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
] as const;
const responseHeaders = [
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "retry-after",
] as const;

const failure = (status: number, error: string, message: string) =>
  HttpServerResponse.jsonUnsafe(
    { error, message },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
const authenticationRequired = () =>
  failure(403, "mcp_authentication_required", "Sign in to this MCP server in Test Rig settings.");

/** Resolves the target from the authenticated session, never from a caller-supplied URL. */
export const handleRequest = Effect.fn("AppMcpProxy.handleRequest")(function* (name: string) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const registry = yield* McpSessionRegistry;
  const authorization = request.headers.authorization;
  const rawToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const invocation = yield* registry.resolve(rawToken);
  const session =
    invocation === undefined
      ? undefined
      : McpProviderSession.readMcpProviderSession(invocation.threadId);
  if (invocation === undefined || session?.providerSessionId !== invocation.providerSessionId) {
    return failure(
      401,
      "invalid_mcp_credential",
      "A valid provider-scoped MCP bearer credential is required.",
    );
  }
  const server = session.appMcpServers?.find((candidate) => candidate.name === name);
  if (server?.transport.type !== "http") {
    return failure(
      404,
      "mcp_server_unavailable",
      "This MCP server is unavailable in this session.",
    );
  }
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
    return HttpServerResponse.empty({ status: 405, headers: { allow: "GET, POST, DELETE" } });
  }
  const oauth = yield* AppMcpOAuth;
  const client = yield* HttpClient.HttpClient;
  const requestScope = yield* Effect.scope;
  const transport = server.transport;
  // Buffer the request only, so a token rejected before execution can be refreshed and retried.
  const body = request.method === "POST" ? new Uint8Array(yield* request.arrayBuffer) : undefined;
  const headers = mcpServerVariableRecord(transport.headers);
  const configuredAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization",
  );
  for (const header of requestHeaders) {
    const value = request.headers[header];
    if (value !== undefined) headers[header] = value;
  }
  const send = Effect.fn("AppMcpProxy.send")(function* (accessToken: string | null) {
    const upstreamHeaders = { ...headers };
    if (accessToken !== null) {
      for (const key of Object.keys(upstreamHeaders)) {
        if (key.toLowerCase() === "authorization") delete upstreamHeaders[key];
      }
      upstreamHeaders.authorization = `Bearer ${accessToken}`;
    }
    let upstream = HttpClientRequest.make(request.method)(transport.url, {
      headers: upstreamHeaders,
    });
    if (body !== undefined) {
      upstream = HttpClientRequest.bodyUint8Array(upstream, body, request.headers["content-type"]);
    }
    const scope = yield* Scope.fork(requestScope);
    const release = Scope.close(scope, Exit.void);
    const response = yield* HttpClient.withScope(client)
      .execute(upstream)
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.onError(() => release),
      );
    return { response, release };
  });
  return yield* Effect.gen(function* () {
    const accessToken = configuredAuthorization ? null : yield* oauth.accessToken(transport.url);
    let upstream = yield* send(accessToken);
    if (upstream.response.status === 401 && accessToken !== null) {
      yield* upstream.release;
      const refreshed = yield* oauth.accessToken(transport.url, { forceRefresh: true });
      if (refreshed !== null) upstream = yield* send(refreshed);
    }
    const { response, release } = upstream;
    // A provider must not start its own OAuth flow against the local proxy URL.
    if (response.status === 401) {
      yield* release;
      if (!configuredAuthorization) yield* oauth.markExpired(transport.url);
      return authenticationRequired();
    }
    const forwarded: Record<string, string> = { "cache-control": "no-store" };
    for (const header of responseHeaders) {
      const value = response.headers[header];
      if (value !== undefined) forwarded[header] = value;
    }
    if (response.status === 204 || response.status === 202) {
      yield* release;
      return HttpServerResponse.empty({ status: response.status, headers: forwarded });
    }
    return HttpServerResponse.stream(response.stream.pipe(Stream.ensuring(release)), {
      status: response.status,
      headers: forwarded,
    });
  }).pipe(
    Effect.catchTag("McpRuntimeError", () => Effect.succeed(authenticationRequired())),
    Effect.catch(() =>
      Effect.succeed(
        failure(502, "mcp_upstream_unavailable", "The MCP server could not be reached."),
      ),
    ),
  );
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const oauth = yield* AppMcpOAuth;
    const client = yield* HttpClient.HttpClient;
    const registry = yield* McpSessionRegistry;
    return HttpRouter.add(
      "*",
      "/mcp/app/:name",
      HttpRouter.params.pipe(
        Effect.flatMap(({ name }) => handleRequest(name ?? "")),
        Effect.provideService(AppMcpOAuth, oauth),
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(McpSessionRegistry, registry),
      ),
    );
  }),
);
