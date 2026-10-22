import * as NodeCrypto from "node:crypto";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { makeWithOptions } from "./AppMcpOAuth.ts";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

const endpoint = "https://mcp.example.test/v2/mcp";
const callbackUrl = "http://localhost:4310/oauth/mcp/callback";
const issuer = "https://auth.example.test/tenant";
const metadataUrl = "https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp";

function fixture(options: { readonly refreshToken?: boolean } = {}) {
  const secrets = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  let failRefresh = false;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === endpoint)
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"` },
      });
    if (url === metadataUrl)
      return json({
        resource: endpoint,
        authorization_servers: [issuer],
        scopes_supported: ["tools"],
      });
    if (url === "https://auth.example.test/.well-known/oauth-authorization-server/tenant")
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url === `${issuer}/register`)
      return json({
        client_id: "test-rig-client",
        redirect_uris: [callbackUrl],
        token_endpoint_auth_method: "none",
      });
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        if (failRefresh)
          return json(
            { error: "invalid_grant", error_description: "secret server diagnostic" },
            400,
          );
        return json({ access_token: "refreshed-access", token_type: "Bearer", expires_in: 3600 });
      }
      assert.strictEqual(body.get("code"), "authorization-code");
      assert.strictEqual(body.get("redirect_uri"), callbackUrl);
      assert.strictEqual(body.get("resource"), endpoint);
      assert.isNotNull(body.get("code_verifier"));
      return json({
        access_token: "first-access",
        token_type: "Bearer",
        ...(options.refreshToken === false ? {} : { refresh_token: "refresh-secret" }),
        expires_in: 60,
      });
    }
    return json({}, 404);
  };
  const store = ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        secrets.set(name, value);
      }),
    remove: (name) =>
      Effect.sync(() => {
        secrets.delete(name);
      }),
    create: () => Effect.die("unused"),
    getOrCreateRandom: () => Effect.die("unused"),
  });
  return {
    secrets,
    requests,
    store,
    fetch,
    failRefresh: () => {
      failRefresh = true;
    },
  };
}

it.effect(
  "discovers the challenge issuer, performs PKCE, persists shared credentials and refreshes after restart",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      const oauth = yield* makeWithOptions({ fetch: test.fetch }).pipe(
        Effect.provideService(ServerSecretStore, test.store),
      );
      assert.deepEqual(yield* oauth.status(endpoint), {
        state: "signed-out",
        expiresAt: null,
        authenticationRequired: false,
      });
      const started = yield* oauth.authenticate({ serverUrl: endpoint, callbackUrl });
      const authorization = new URL(started.authorizationUrl!);
      assert.strictEqual(authorization.origin, new URL(issuer).origin);
      assert.strictEqual(authorization.searchParams.get("state"), started.flowId);
      assert.strictEqual(authorization.searchParams.get("code_challenge_method"), "S256");
      assert.strictEqual(authorization.searchParams.get("scope"), "tools");
      assert.strictEqual(authorization.searchParams.get("resource"), endpoint);
      yield* oauth.complete({ state: started.flowId!, code: "authorization-code" });
      const tokenRequest = test.requests.find(({ url }) => url === `${issuer}/token`)!;
      const verifier = new URLSearchParams(String(tokenRequest.init?.body)).get("code_verifier")!;
      assert.strictEqual(
        NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
        authorization.searchParams.get("code_challenge"),
      );
      assert.strictEqual((yield* oauth.status(endpoint)).state, "signed-in");
      assert.strictEqual(yield* oauth.accessToken(`${endpoint}#fragment`), "first-access");
      assert.strictEqual(test.secrets.size, 1);
      assert.isTrue(
        (yield* oauth
          .complete({ state: started.flowId!, code: "authorization-code" })
          .pipe(Effect.result))._tag === "Failure",
      );
      const restarted = yield* makeWithOptions({ fetch: test.fetch }).pipe(
        Effect.provideService(ServerSecretStore, test.store),
      );
      yield* TestClock.adjust("61 seconds");
      // An expired access token remains signed in while its refresh grant can renew it.
      assert.strictEqual((yield* restarted.status(endpoint)).state, "signed-in");
      assert.strictEqual(yield* restarted.accessToken(endpoint), "refreshed-access");
      assert.strictEqual((yield* restarted.status(endpoint)).state, "signed-in");
      const saved = JSON.parse(new TextDecoder().decode([...test.secrets.values()][0]));
      assert.strictEqual(saved.tokens.refresh_token, "refresh-secret");
      yield* restarted.signOut(endpoint);
      assert.strictEqual(yield* restarted.accessToken(endpoint), null);
      assert.strictEqual(test.secrets.size, 0);
    }),
);

it.effect(
  "sign-out cancels pending flows, expired flows cannot redeem, and upstream rejection is visible without tokens",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      const oauth = yield* makeWithOptions({ fetch: test.fetch }).pipe(
        Effect.provideService(ServerSecretStore, test.store),
      );
      yield* oauth.markExpired(endpoint);
      assert.deepEqual(yield* oauth.status(endpoint), {
        state: "signed-out",
        expiresAt: null,
        authenticationRequired: true,
      });
      const cancelled = yield* oauth.authenticate({ serverUrl: endpoint, callbackUrl });
      yield* oauth.signOut(endpoint);
      const cancellation = yield* oauth
        .complete({ state: cancelled.flowId!, code: "authorization-code" })
        .pipe(Effect.result);
      assert.strictEqual(cancellation._tag, "Failure");
      const expired = yield* oauth.authenticate({ serverUrl: endpoint, callbackUrl });
      yield* TestClock.adjust("10 minutes");
      assert.strictEqual(
        (yield* oauth
          .complete({ state: expired.flowId!, code: "authorization-code" })
          .pipe(Effect.result))._tag,
        "Failure",
      );
      assert.strictEqual(test.secrets.size, 0);
    }),
);

it.effect(
  "invalid refresh grants expire credentials without exposing server errors; sign-out clears them",
  () =>
    Effect.gen(function* () {
      const test = fixture();
      const oauth = yield* makeWithOptions({ fetch: test.fetch }).pipe(
        Effect.provideService(ServerSecretStore, test.store),
      );
      const started = yield* oauth.authenticate({ serverUrl: endpoint, callbackUrl });
      yield* oauth.complete({ state: started.flowId!, code: "authorization-code" });
      test.failRefresh();
      assert.strictEqual(yield* oauth.accessToken(endpoint, { forceRefresh: true }), null);
      assert.strictEqual((yield* oauth.status(endpoint)).state, "expired");
      assert.strictEqual(yield* oauth.accessToken(endpoint), null);
      yield* oauth.signOut(endpoint);
      assert.strictEqual((yield* oauth.status(endpoint)).state, "signed-out");
    }),
);

it.effect(
  "access-token expiry without a refresh grant requires sign-in, and sign-out recovers corrupt credentials",
  () =>
    Effect.gen(function* () {
      const test = fixture({ refreshToken: false });
      const oauth = yield* makeWithOptions({ fetch: test.fetch }).pipe(
        Effect.provideService(ServerSecretStore, test.store),
      );
      const started = yield* oauth.authenticate({ serverUrl: endpoint, callbackUrl });
      yield* oauth.complete({ state: started.flowId!, code: "authorization-code" });
      yield* TestClock.adjust("61 seconds");
      assert.strictEqual((yield* oauth.status(endpoint)).state, "expired");
      assert.strictEqual(yield* oauth.accessToken(endpoint), null);
      for (const name of test.secrets.keys())
        test.secrets.set(name, new TextEncoder().encode("corrupt"));
      assert.strictEqual((yield* oauth.status(endpoint).pipe(Effect.result))._tag, "Failure");
      yield* oauth.signOut(endpoint);
      assert.strictEqual((yield* oauth.status(endpoint)).state, "signed-out");
    }),
);
