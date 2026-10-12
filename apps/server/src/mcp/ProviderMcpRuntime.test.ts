import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  McpRuntimeError,
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
