import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";

import * as ServerConfig from "./config.ts";
import * as Layer from "effect/Layer";
import * as ProjectService from "./project/ProjectService.ts";
import * as ThreadManagement from "./orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "./orchestration-v2/ThreadLaunchService.ts";
import { v2Projection, v2Project, v2ThreadShell } from "./orchestration-v2/testkit/fixtures.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";

it("uses the canonical Codex default for auto-bootstrapped model selection", () => {
  assert.deepStrictEqual(ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(), {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  });
});

it.effect("enqueueCommand waits for readiness and then drains queued work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const executionCount = yield* Ref.make(0);
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Ref.updateAndGet(executionCount, (count) => count + 1))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(executionCount), 0);

      yield* commandGate.signalCommandReady;

      const result = yield* Fiber.join(queuedCommandFiber);
      assert.equal(result, 1);
      assert.equal(yield* Ref.get(executionCount), 1);
    }),
  ),
);

it.effect("enqueueCommand fails queued work when readiness fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;
      const failure = yield* Deferred.make<void, never>();

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Deferred.await(failure).pipe(Effect.as("should-not-run")))
        .pipe(Effect.forkScoped);

      yield* commandGate.failCommandReady(
        new ServerRuntimeStartup.ServerRuntimeStartupError({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
          cause: new Error("test startup failure"),
        }),
      );

      const error = yield* Effect.flip(Fiber.join(queuedCommandFiber));
      assert.equal(error.message, "Server runtime startup failed before command readiness.");
    }),
  ),
);

it.effect("launchStartupHeartbeat does not block the caller while counts are loading", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const releaseCounts = yield* Deferred.make<void, never>();

      yield* ServerRuntimeStartup.launchStartupHeartbeat.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectService.ProjectService)({
              snapshot: Effect.succeed({ projects: [], updatedAt: "2026-01-01T00:00:00.000Z" }),
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getShellSnapshot: () =>
                Deferred.await(releaseCounts).pipe(
                  Effect.as({
                    schemaVersion: 1,
                    snapshotSequence: 0,
                    threads: [],
                    archivedThreads: [],
                  }),
                ),
            }),
          ),
        ),
        Effect.provideService(AnalyticsService.AnalyticsService, {
          record: () => Effect.void,
          flush: Effect.void,
        }),
      );
    }),
  ),
);

it.effect("resolveWelcomeBase derives cwd and project name from server config", () =>
  Effect.gen(function* () {
    const welcome = yield* ServerRuntimeStartup.resolveWelcomeBase.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
      } as never),
    );

    assert.deepStrictEqual(welcome, {
      cwd: "/tmp/startup-project",
      projectName: "startup-project",
    });
  }),
);

const project = { ...v2Project, deletedAt: null };
function bootstrapLayer(input: {
  existing: boolean;
  launch?: ThreadLaunch.ThreadLaunchService["Service"]["launch"];
}) {
  return Layer.mergeAll(
    Layer.mock(ProjectService.ProjectService)({
      bootstrap: () => Effect.succeed({ project, created: !input.existing }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getShellSnapshot: () =>
        Effect.succeed({
          schemaVersion: 1,
          snapshotSequence: 0,
          threads: input.existing ? [v2ThreadShell] : [],
          archivedThreads: [],
        }),
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: input.launch ?? (() => Effect.die("Unexpected thread launch")),
    }),
    Layer.succeed(ServerConfig.ServerConfig, {
      cwd: "/tmp/startup-project",
      autoBootstrapProjectFromCwd: true,
    } as never),
  );
}

it.effect("resolveAutoBootstrapWelcomeTargets returns existing project and thread ids", () =>
  Effect.gen(function* () {
    const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets;
    assert.deepStrictEqual(targets, {
      bootstrapProjectId: project.id,
      bootstrapThreadId: v2ThreadShell.id,
    });
  }).pipe(Effect.provide(Layer.merge(bootstrapLayer({ existing: true }), NodeServices.layer))),
);

it.effect(
  "resolveAutoBootstrapWelcomeTargets launches a missing root thread with the canonical default",
  () => {
    const launches: ThreadLaunch.ThreadLaunchInput[] = [];
    return Effect.gen(function* () {
      const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets;
      assert.equal(targets.bootstrapProjectId, project.id);
      assert.equal(targets.bootstrapThreadId, v2ThreadShell.id);
      assert.equal(launches.length, 1);
      assert.deepStrictEqual(
        launches[0]?.modelSelection,
        ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(),
      );
      assert.deepStrictEqual(launches[0]?.workspaceStrategy, { type: "root" });
      assert.equal(launches[0]?.createdBy, "system");
    }).pipe(
      Effect.provide(
        bootstrapLayer({
          existing: false,
          launch: (input) =>
            Effect.sync(() => {
              launches.push(input);
              return { threadId: v2ThreadShell.id, projection: v2Projection, resumed: false };
            }),
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    );
  },
);

it.effect("resolveAutoBootstrapWelcomeTargets preserves typed UUID generation failures", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const uuidError = PlatformError.systemError({
      _tag: "Unknown",
      module: "Crypto",
      method: "randomUUIDv4",
      description: "UUID generation unavailable",
    });
    const error = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(Crypto.Crypto, { ...crypto, randomUUIDv4: Effect.fail(uuidError) }),
      Effect.flip,
    );
    assert.strictEqual(error, uuidError);
  }).pipe(Effect.provide(Layer.merge(bootstrapLayer({ existing: false }), NodeServices.layer))),
);
