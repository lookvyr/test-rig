import * as NodeCrypto from "node:crypto";
import {
  auth,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  selectResourceURL,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpRuntimeError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";

const Credentials = Schema.Struct({
  callbackUrl: Schema.String,
  client: Schema.Struct({
    client_id: Schema.String,
    client_secret: Schema.optional(Schema.String),
    token_endpoint_auth_method: Schema.optional(Schema.String),
  }),
  tokens: Schema.optional(
    Schema.Struct({
      access_token: Schema.String,
      token_type: Schema.String,
      refresh_token: Schema.optional(Schema.String),
      expires_in: Schema.optional(Schema.Number),
      scope: Schema.optional(Schema.String),
    }),
  ),
  expiresAt: Schema.NullOr(Schema.Number),
  invalidated: Schema.Boolean,
});
type Credentials = typeof Credentials.Type;
const decodeCredentials = Schema.decodeUnknownEffect(Schema.fromJsonString(Credentials));

export interface AppMcpOAuthStatus {
  readonly state: "signed-out" | "signed-in" | "expired";
  readonly expiresAt: string | null;
  readonly authenticationRequired: boolean;
}

export interface AppMcpOAuthShape {
  readonly status: (serverUrl: string) => Effect.Effect<AppMcpOAuthStatus, McpRuntimeError>;
  readonly authenticate: (input: {
    readonly serverUrl: string;
    readonly callbackUrl: string;
  }) => Effect.Effect<
    { readonly authorizationUrl: string | null; readonly flowId: string | null },
    McpRuntimeError
  >;
  /** Also accepts a callback forwarded by a remote browser after a loopback redirect. */
  readonly complete: (input: {
    readonly state: string;
    readonly code?: string;
    readonly error?: string;
  }) => Effect.Effect<void, McpRuntimeError>;
  readonly accessToken: (
    serverUrl: string,
    options?: { readonly forceRefresh?: boolean },
  ) => Effect.Effect<string | null, McpRuntimeError>;
  readonly markExpired: (serverUrl: string) => Effect.Effect<void, McpRuntimeError>;
  readonly signOut: (serverUrl: string) => Effect.Effect<void, McpRuntimeError>;
}

export class AppMcpOAuth extends Context.Service<AppMcpOAuth, AppMcpOAuthShape>()(
  "t3/mcp/AppMcpOAuth",
) {}

class OAuthRefreshError extends Schema.TaggedError<OAuthRefreshError>()("OAuthRefreshError", {
  cause: Schema.Defect(),
}) {}

const failure = (message: string) => new McpRuntimeError({ operation: "oauth", message });
const canonicalUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Unsupported URL");
      url.hash = "";
      return url.href;
    },
    catch: () => failure("MCP sign-in requires an HTTP or HTTPS URL without embedded credentials."),
  });
const secretName = (url: string) =>
  `mcp-oauth-${NodeCrypto.createHash("sha256").update(url).digest("hex")}`;
const FLOW_LIFETIME_MS = 10 * 60 * 1_000;

const discoverChallenge = async (url: string, fetchFn: FetchLike) => {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { Accept: "application/json, text/event-stream" },
  });
  const challenge = extractWWWAuthenticateParams(response);
  await response.body?.cancel();
  return challenge;
};

interface PendingFlow {
  readonly serverUrl: string;
  readonly callbackUrl: string;
  readonly createdAt: number;
  readonly provider: OAuthClientProvider;
  client: OAuthClientInformationMixed | undefined;
  tokens: OAuthTokens | undefined;
  authorizationUrl: string | null;
  verifier: string | undefined;
  discovery: OAuthDiscoveryState | undefined;
}

/** Fetch injection keeps protocol tests local and does not change persisted credential identity. */
export const makeWithOptions = Effect.fn("AppMcpOAuth.make")(function* (
  options: { readonly fetch?: FetchLike } = {},
) {
  const secrets = yield* ServerSecretStore;
  const locks = new Map<string, Semaphore.Semaphore>();
  const pending = new Map<string, PendingFlow>();
  const authenticationRequired = new Set<string>();
  const lock = (url: string) => {
    let mutex = locks.get(url);
    if (!mutex) {
      mutex = Semaphore.makeUnsafe(1);
      locks.set(url, mutex);
    }
    return mutex;
  };
  const request =
    (signal: AbortSignal): FetchLike =>
    (url, init) =>
      (options.fetch ?? globalThis.fetch)(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(15_000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
  const load = Effect.fn("AppMcpOAuth.load")(function* (url: string) {
    const value = yield* secrets
      .get(secretName(url))
      .pipe(Effect.mapError(() => failure("Could not read MCP sign-in credentials.")));
    if (Option.isNone(value)) return undefined;
    return yield* decodeCredentials(new TextDecoder().decode(value.value)).pipe(
      Effect.mapError(() =>
        failure("The saved MCP sign-in credentials could not be read. Sign out and sign in again."),
      ),
    );
  });
  const save = (url: string, value: Credentials) =>
    secrets
      .set(secretName(url), new TextEncoder().encode(JSON.stringify(value)))
      .pipe(Effect.mapError(() => failure("Could not save MCP sign-in credentials.")));
  const prune = (now: number) => {
    for (const [state, flow] of pending) {
      if (now - flow.createdAt >= FLOW_LIFETIME_MS) pending.delete(state);
    }
  };
  const status = Effect.fn("AppMcpOAuth.status")(function* (serverUrl: string) {
    const url = yield* canonicalUrl(serverUrl);
    const record = yield* load(url);
    if (!record?.tokens)
      return {
        state: "signed-out" as const,
        expiresAt: null,
        authenticationRequired: authenticationRequired.has(url),
      };
    const now = yield* Clock.currentTimeMillis;
    return {
      state:
        record.invalidated ||
        (record.expiresAt !== null && record.expiresAt <= now && !record.tokens.refresh_token)
          ? ("expired" as const)
          : ("signed-in" as const),
      expiresAt:
        record.expiresAt === null
          ? null
          : DateTime.formatIso(DateTime.makeUnsafe(record.expiresAt)),
      authenticationRequired: true,
    };
  });
  const authenticate = Effect.fn("AppMcpOAuth.authenticate")(function* (input: {
    readonly serverUrl: string;
    readonly callbackUrl: string;
  }) {
    const serverUrl = yield* canonicalUrl(input.serverUrl);
    const callbackUrl = yield* canonicalUrl(input.callbackUrl);
    return yield* lock(serverUrl).withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        prune(now);
        const record = yield* load(serverUrl);
        const state = NodeCrypto.randomBytes(32).toString("base64url");
        const flow: PendingFlow = {
          serverUrl,
          callbackUrl,
          createdAt: now,
          client: record?.callbackUrl === callbackUrl ? record.client : undefined,
          tokens: undefined,
          authorizationUrl: null,
          verifier: undefined,
          discovery: undefined,
          provider: {
            redirectUrl: callbackUrl,
            clientMetadata: {
              client_name: "Test Rig",
              redirect_uris: [callbackUrl],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
            state: () => state,
            clientInformation: () => flow.client,
            saveClientInformation: (client) => {
              flow.client = client;
            },
            tokens: () => undefined,
            saveTokens: (tokens) => {
              flow.tokens = tokens;
            },
            redirectToAuthorization: (url) => {
              flow.authorizationUrl = url.href;
            },
            saveCodeVerifier: (verifier) => {
              flow.verifier = verifier;
            },
            codeVerifier: () => {
              if (!flow.verifier) throw new Error("Missing PKCE verifier");
              return flow.verifier;
            },
            discoveryState: () => flow.discovery,
            saveDiscoveryState: (discovery) => {
              flow.discovery = discovery;
            },
            invalidateCredentials: (scope) => {
              if (scope === "all" || scope === "client") flow.client = undefined;
              if (scope === "all" || scope === "discovery") flow.discovery = undefined;
              if (scope === "all" || scope === "tokens") flow.tokens = undefined;
            },
          },
        };
        yield* Effect.tryPromise({
          try: async (signal) => {
            const fetchFn = request(signal);
            const challenge = await discoverChallenge(serverUrl, fetchFn);
            return auth(flow.provider, { serverUrl, fetchFn, ...challenge });
          },
          catch: () =>
            failure(
              "This MCP server could not start OAuth sign-in. It must support OAuth discovery and dynamic client registration.",
            ),
        });
        if (!flow.authorizationUrl || !flow.verifier || !flow.client)
          return yield* failure("The MCP server did not return a sign-in URL.");
        flow.authorizationUrl = yield* canonicalUrl(flow.authorizationUrl);
        // A new attempt replaces older attempts for this endpoint.
        for (const [key, value] of pending) if (value.serverUrl === serverUrl) pending.delete(key);
        pending.set(state, flow);
        authenticationRequired.add(serverUrl);
        return { authorizationUrl: flow.authorizationUrl, flowId: state };
      }),
    );
  });
  const complete = Effect.fn("AppMcpOAuth.complete")(function* (input: {
    readonly state: string;
    readonly code?: string;
    readonly error?: string;
  }) {
    const flow = pending.get(input.state);
    if (!flow)
      return yield* failure(
        "This MCP sign-in attempt has expired or was cancelled. Start sign-in again.",
      );
    return yield* lock(flow.serverUrl).withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        prune(now);
        if (pending.get(input.state) !== flow)
          return yield* failure(
            "This MCP sign-in attempt has expired or was cancelled. Start sign-in again.",
          );
        pending.delete(input.state);
        if (input.error || !input.code)
          return yield* failure("MCP sign-in was cancelled or denied. Start sign-in again.");
        yield* Effect.tryPromise({
          try: (signal) =>
            auth(flow.provider, {
              serverUrl: flow.serverUrl,
              authorizationCode: input.code!,
              fetchFn: request(signal),
            }),
          catch: () => failure("The MCP server could not complete sign-in. Start sign-in again."),
        });
        if (!flow.tokens || !flow.client)
          return yield* failure("The MCP server did not return sign-in credentials.");
        const issuedAt = yield* Clock.currentTimeMillis;
        yield* save(flow.serverUrl, {
          callbackUrl: flow.callbackUrl,
          client: flow.client,
          tokens: flow.tokens,
          expiresAt:
            flow.tokens.expires_in === undefined ? null : issuedAt + flow.tokens.expires_in * 1_000,
          invalidated: false,
        });
      }),
    );
  });
  const accessToken = Effect.fn("AppMcpOAuth.accessToken")(function* (
    serverUrl: string,
    refreshOptions?: { readonly forceRefresh?: boolean },
  ) {
    const url = yield* canonicalUrl(serverUrl);
    return yield* lock(url).withPermits(1)(
      Effect.gen(function* () {
        const record = yield* load(url);
        if (!record?.tokens) return null;
        const now = yield* Clock.currentTimeMillis;
        if (
          !refreshOptions?.forceRefresh &&
          !record.invalidated &&
          (record.expiresAt === null || record.expiresAt > now)
        )
          return record.tokens.access_token;
        if (!record.tokens.refresh_token) {
          yield* save(url, { ...record, invalidated: true });
          return null;
        }
        const refreshed = yield* Effect.tryPromise({
          try: async (signal) => {
            const fetchFn = request(signal);
            const challenge = await discoverChallenge(url, fetchFn);
            const discovery = await discoverOAuthServerInfo(url, {
              fetchFn,
              ...(challenge.resourceMetadataUrl
                ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
                : {}),
            });
            const resource = await selectResourceURL(
              url,
              {
                redirectUrl: record.callbackUrl,
                clientMetadata: { redirect_uris: [record.callbackUrl] },
                clientInformation: () => record.client,
                tokens: () => record.tokens,
                saveTokens: () => {},
                redirectToAuthorization: () => {},
                saveCodeVerifier: () => {},
                codeVerifier: () => "",
              },
              discovery.resourceMetadata,
            );
            return refreshAuthorization(discovery.authorizationServerUrl, {
              ...(discovery.authorizationServerMetadata
                ? { metadata: discovery.authorizationServerMetadata }
                : {}),
              clientInformation: record.client,
              refreshToken: record.tokens!.refresh_token!,
              ...(resource ? { resource } : {}),
              fetchFn,
            });
          },
          catch: (cause) => new OAuthRefreshError({ cause }),
        }).pipe(Effect.result);
        if (refreshed._tag === "Failure") {
          const cause = refreshed.failure.cause;
          if (
            cause instanceof InvalidGrantError ||
            cause instanceof InvalidClientError ||
            cause instanceof UnauthorizedClientError
          ) {
            yield* save(url, {
              ...record,
              invalidated: true,
              tokens: { ...record.tokens, refresh_token: undefined },
            });
            return null;
          }
          return yield* failure("Could not refresh MCP sign-in. Try again or sign in again.");
        }
        const issuedAt = yield* Clock.currentTimeMillis;
        yield* save(url, {
          ...record,
          tokens: refreshed.success,
          invalidated: false,
          expiresAt:
            refreshed.success.expires_in === undefined
              ? null
              : issuedAt + refreshed.success.expires_in * 1_000,
        });
        return refreshed.success.access_token;
      }),
    );
  });
  const markExpired = Effect.fn("AppMcpOAuth.markExpired")(function* (serverUrl: string) {
    const url = yield* canonicalUrl(serverUrl);
    authenticationRequired.add(url);
    yield* lock(url).withPermits(1)(
      Effect.gen(function* () {
        const record = yield* load(url);
        if (record) yield* save(url, { ...record, invalidated: true });
      }),
    );
  });
  const signOut = Effect.fn("AppMcpOAuth.signOut")(function* (serverUrl: string) {
    const url = yield* canonicalUrl(serverUrl);
    yield* lock(url).withPermits(1)(
      Effect.gen(function* () {
        authenticationRequired.add(url);
        for (const [state, flow] of pending) if (flow.serverUrl === url) pending.delete(state);
        yield* secrets
          .remove(secretName(url))
          .pipe(Effect.mapError(() => failure("Could not remove MCP sign-in credentials.")));
      }),
    );
  });
  return AppMcpOAuth.of({ status, authenticate, complete, accessToken, markExpired, signOut });
});

export const layer = Layer.effect(AppMcpOAuth, makeWithOptions());
