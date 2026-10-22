import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  McpRuntimeError,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import {
  registerProviderMcpRuntime,
  listMcpRuntimeStatuses,
  reconnectMcpServer,
  authenticateMcpServer,
  normalizeMcpRuntimeState,
  type ProviderMcpRuntime,
} from "./ProviderMcpRuntime.ts";
import { AppMcpOAuth, type AppMcpOAuthStatus } from "./AppMcpOAuth.ts";
import * as McpProviderSession from "./McpProviderSession.ts";

const runtime = (name: string, project = "project-a"): ProviderMcpRuntime => ({
  identity: {
    threadId: ThreadId.make(name),
    projectId: ProjectId.make(project),
    provider: "claudeAgent",
    providerSessionId: ProviderSessionId.make(`session-${name}`),
    providerInstanceId: ProviderInstanceId.make("claude"),
  },
  servers: [{ name: "github", runtimeName: "tru-github" }],
  status: () => Effect.succeed({ state: "connected", toolCount: 3 }),
  reconnect: () => Effect.void,
});
it.effect(
  "attributes statuses and filters by project; disposal of an old session preserves replacement",
  () =>
    Effect.gen(function* () {
      const first = runtime("runtime-one");
      const disposeFirst = registerProviderMcpRuntime(first);
      const other = runtime("runtime-other", "project-b");
      const disposeOther = registerProviderMcpRuntime(other);
      const replacement = {
        ...first,
        status: () => Effect.succeed({ state: "disconnected" as const }),
      };
      const disposeReplacement = registerProviderMcpRuntime(replacement);
      try {
        disposeFirst();
        const statuses = yield* listMcpRuntimeStatuses({ projectId: ProjectId.make("project-a") });
        assert.lengthOf(statuses, 1);
        assert.deepInclude(statuses[0], {
          ...first.identity,
          state: "disconnected",
          runtimeName: "tru-github",
          toolCount: null,
          reconnectSupported: true,
          authenticateSupported: false,
        });
        disposeReplacement();
        assert.deepEqual(
          yield* listMcpRuntimeStatuses({ projectId: ProjectId.make("project-a") }),
          [],
        );
      } finally {
        disposeFirst();
        disposeOther();
        disposeReplacement();
      }
    }),
);
it.effect("drops in-flight inventory results after that runtime closes", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const current = {
      ...runtime("in-flight"),
      status: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({ state: "connected" as const }),
        ),
    };
    const dispose = registerProviderMcpRuntime(current);
    try {
      const listing = yield* listMcpRuntimeStatuses({}).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      dispose();
      yield* Deferred.succeed(release, undefined);
      assert.deepEqual(yield* Fiber.join(listing), []);
    } finally {
      dispose();
    }
  }),
);
it.effect("withholds unsupported actions, sanitizes provider errors and validates OAuth URLs", () =>
  Effect.gen(function* () {
    const input = { threadId: ThreadId.make("capabilities"), serverName: "github" };
    const current = {
      ...runtime("capabilities"),
      reconnect: undefined,
      status: () => Effect.succeed({ state: "needs-auth" as const, authenticateSupported: true }),
      authenticate: () => Effect.succeed({ authorizationUrl: "file:///tmp/unsafe" }),
    };
    const { reconnect: _, ...withoutReconnect } = current;
    let dispose = registerProviderMcpRuntime(withoutReconnect);
    try {
      const statuses = yield* listMcpRuntimeStatuses({});
      assert.isFalse(statuses[0]?.reconnectSupported);
      assert.isTrue(statuses[0]?.authenticateSupported);
      assert.isTrue(Exit.isFailure(yield* reconnectMcpServer(input).pipe(Effect.exit)));
      assert.isTrue(Exit.isFailure(yield* authenticateMcpServer(input).pipe(Effect.exit)));
      dispose();
      dispose = registerProviderMcpRuntime({
        ...withoutReconnect,
        status: () =>
          Effect.fail(
            new McpRuntimeError({
              operation: "provider",
              message: "secret-token-in-provider-message",
            }),
          ),
      });
      const failed = yield* listMcpRuntimeStatuses({});
      assert.notInclude(failed[0]?.error ?? "", "secret-token");
      assert.equal(failed[0]?.state, "unknown");
      assert.isFalse(failed[0]?.authenticateSupported);
    } finally {
      dispose();
    }
  }),
);
it("normalizes only observed provider states", () => {
  assert.equal(normalizeMcpRuntimeState("authenticationRequired"), "needs-auth");
  assert.equal(normalizeMcpRuntimeState("needs_auth"), "needs-auth");
  assert.equal(normalizeMcpRuntimeState("pending"), "connecting");
  assert.equal(normalizeMcpRuntimeState(undefined), "unknown");
});

it.effect("reads a provider inventory once for all configured entries in a refresh", () =>
  Effect.gen(function* () {
    let requests = 0;
    const current = {
      ...runtime("inventory"),
      servers: [
        { name: "one", runtimeName: "tru-one" },
        { name: "two", runtimeName: "tru-two" },
      ],
      inventory: Effect.sync(() => {
        requests++;
        return new Map([
          ["tru-one", { state: "connected" as const }],
          ["tru-two", { state: "needs-auth" as const }],
        ]);
      }),
      status: () => Effect.die("must use inventory"),
    };
    const dispose = registerProviderMcpRuntime(current);
    try {
      const statuses = yield* listMcpRuntimeStatuses({});
      assert.equal(requests, 1);
      assert.deepEqual(
        statuses.map((status) => status.state),
        ["connected", "needs-auth"],
      );
    } finally {
      dispose();
    }
  }),
);

it.effect("skips inventories when no app-owned server matches the refresh", () =>
  Effect.gen(function* () {
    const empty = {
      ...runtime("empty-inventory"),
      servers: [],
      inventory: Effect.die("empty inventory must not be requested"),
    };
    const filtered = {
      ...runtime("filtered-inventory"),
      inventory: Effect.die("filtered inventory must not be requested"),
    };
    const disposeEmpty = registerProviderMcpRuntime(empty);
    const disposeFiltered = registerProviderMcpRuntime(filtered);
    try {
      assert.deepEqual(yield* listMcpRuntimeStatuses({ serverName: "another-server" }), []);
      disposeFiltered();
      assert.deepEqual(yield* listMcpRuntimeStatuses({}), []);
    } finally {
      disposeEmpty();
      disposeFiltered();
    }
  }),
);

it.effect("requires sign-in instead of reconnecting an unauthenticated server", () =>
  Effect.gen(function* () {
    let reconnects = 0;
    const current = {
      ...runtime("signed-out"),
      status: () => Effect.succeed({ state: "needs-auth" as const }),
      reconnect: () =>
        Effect.sync(() => {
          reconnects++;
        }),
    };
    const dispose = registerProviderMcpRuntime(current);
    try {
      const statuses = yield* listMcpRuntimeStatuses({});
      assert.isFalse(statuses[0]?.reconnectSupported);
      const result = yield* reconnectMcpServer({
        threadId: current.identity.threadId,
        serverName: "github",
      }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.include(result.failure.message, "requires sign-in");
      assert.equal(reconnects, 0);
    } finally {
      dispose();
    }
  }),
);

it.effect("returns the provider's reconnect diagnostic", () =>
  Effect.gen(function* () {
    const current = {
      ...runtime("reconnect-error"),
      reconnect: () =>
        Effect.fail(
          new McpRuntimeError({
            operation: "provider",
            message: "MCP connection rejected: authorization expired",
          }),
        ),
    };
    const dispose = registerProviderMcpRuntime(current);
    try {
      const result = yield* reconnectMcpServer({
        threadId: current.identity.threadId,
        serverName: "github",
      }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.equal(result.failure.message, "MCP connection rejected: authorization expired");
    } finally {
      dispose();
    }
  }),
);

const sharedRuntimeHarness = Effect.fn("sharedRuntimeHarness")(function* (input: {
  readonly auth: AppMcpOAuthStatus;
  readonly authorization?: string;
  readonly state?: "needs-auth" | "failed";
}) {
  let reconnects = 0;
  let authenticates = 0;
  let statusRequests = 0;
  const current: ProviderMcpRuntime = {
    ...runtime("shared-oauth"),
    status: () => Effect.succeed({ state: input.state ?? "failed", authenticateSupported: true }),
    reconnect: () =>
      Effect.sync(() => {
        reconnects++;
      }),
    authenticate: () =>
      Effect.sync(() => {
        authenticates++;
        return { authorizationUrl: null };
      }),
  };
  const dispose = registerProviderMcpRuntime(current);
  McpProviderSession.setMcpProviderSession({
    environmentId: EnvironmentId.make("shared-oauth-env"),
    threadId: current.identity.threadId,
    providerSessionId: "shared-oauth-credential",
    providerInstanceId: current.identity.providerInstanceId,
    endpoint: "http://localhost/mcp",
    authorizationHeader: "Bearer local-only",
    browserToolsAvailable: false,
    appMcpServers: [
      {
        name: "github",
        transport: {
          type: "http",
          url: "https://mcp.example.test",
          headers:
            input.authorization === undefined
              ? []
              : [{ name: "aUtHoRiZaTiOn", value: input.authorization, sensitive: true }],
        },
      },
    ],
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      dispose();
      McpProviderSession.clearMcpProviderSession(current.identity.threadId);
    }),
  );
  const oauth = AppMcpOAuth.of({
    status: () =>
      Effect.sync(() => {
        statusRequests++;
        return input.auth;
      }),
    authenticate: () => Effect.die("shared authentication is outside the runtime"),
    complete: () => Effect.void,
    accessToken: () => Effect.die("status must not materialize tokens"),
    markExpired: () => Effect.void,
    signOut: () => Effect.void,
  });
  const operation = { threadId: current.identity.threadId, serverName: "github" };
  const statuses = yield* listMcpRuntimeStatuses({}).pipe(
    Effect.provideService(AppMcpOAuth, oauth),
  );
  const reconnect = yield* reconnectMcpServer(operation).pipe(
    Effect.provideService(AppMcpOAuth, oauth),
    Effect.result,
  );
  const authenticate = yield* authenticateMcpServer(operation).pipe(Effect.result);
  return { statuses, reconnect, authenticate, reconnects, authenticates, statusRequests };
});

it.effect(
  "uses shared HTTP authentication requirements across runtime statuses and operations",
  () =>
    Effect.gen(function* () {
      for (const state of ["expired", "signed-out"] as const) {
        const result = yield* sharedRuntimeHarness({
          auth: { state, expiresAt: null, authenticationRequired: true },
        });
        assert.equal(result.statuses[0]?.state, "needs-auth");
        assert.isFalse(result.statuses[0]?.reconnectSupported);
        assert.isFalse(result.statuses[0]?.authenticateSupported);
        assert.equal(result.reconnect._tag, "Failure");
        assert.equal(result.authenticate._tag, "Failure");
        assert.equal(result.reconnects, 0);
        assert.equal(result.authenticates, 0);
      }
    }).pipe(Effect.scoped),
);

it.effect(
  "allows reconnect after shared sign-in while rejecting provider-native HTTP authentication",
  () =>
    Effect.gen(function* () {
      const result = yield* sharedRuntimeHarness({
        state: "needs-auth",
        auth: { state: "signed-in", expiresAt: null, authenticationRequired: true },
      });
      assert.equal(result.statuses[0]?.state, "disconnected");
      assert.isTrue(result.statuses[0]?.reconnectSupported);
      assert.isFalse(result.statuses[0]?.authenticateSupported);
      assert.equal(result.reconnect._tag, "Success");
      assert.equal(result.reconnects, 1);
      assert.equal(result.authenticate._tag, "Failure");
      assert.equal(result.authenticates, 0);
    }).pipe(Effect.scoped),
);

it.effect("keeps explicitly configured HTTP credentials independent of shared OAuth status", () =>
  Effect.gen(function* () {
    const result = yield* sharedRuntimeHarness({
      authorization: "Bearer configured-account",
      auth: { state: "expired", expiresAt: null, authenticationRequired: true },
    });
    assert.equal(result.statuses[0]?.state, "failed");
    assert.isTrue(result.statuses[0]?.reconnectSupported);
    assert.isFalse(result.statuses[0]?.authenticateSupported);
    assert.equal(result.statusRequests, 0);
    assert.equal(result.reconnects, 1);
    assert.equal(result.authenticates, 0);
  }).pipe(Effect.scoped),
);
