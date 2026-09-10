import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, WS_METHODS, type ReviewDiffPreviewResult } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createReviewEnvironmentAtoms } from "./review.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

const environmentId = EnvironmentId.make("review-environment");
const queryTarget = { environmentId, input: { cwd: "/repo", sourceKind: "staged" as const } };

const makeReviewRuntime = Effect.fn("makeReviewRuntime")(function* () {
  let staged = false;
  let requests = 0;
  const responseGate = Latch.makeUnsafe(true);
  const client = {
    [WS_METHODS.reviewGetDiffPreview]: () =>
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        requests++;
        yield* responseGate.await;
        return {
          cwd: "/repo",
          generatedAt: yield* DateTime.now,
          sources: [
            {
              id: "staged",
              kind: "staged",
              title: "Staged",
              baseRef: "HEAD",
              headRef: null,
              diff: staged ? "staged changes" : "",
              diffHash: String(requests),
              truncated: false,
            },
          ],
        } satisfies ReviewDiffPreviewResult;
      }),
    [WS_METHODS.reviewSetFilesStaged]: () =>
      Effect.sync(() => {
        staged = true;
      }),
  } as unknown as WsRpcProtocolClient;
  const supervisor = EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId,
      label: "Review",
      httpBaseUrl: "http://review.test",
      wsBaseUrl: "ws://review.test",
    }),
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
      generation: 1,
    }),
    session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(
      Option.some({
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      }),
    ),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const run: EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry["Service"]["followStream"] = (_environmentId, stream) =>
    Stream.provideService(stream, EnvironmentSupervisor, supervisor);
  const runtime = Atom.runtime(
    Layer.succeed(
      EnvironmentRegistry,
      EnvironmentRegistry.of({ run, followStream } as unknown as EnvironmentRegistry["Service"]),
    ),
  );
  const tasks = new Set<() => void>();
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() =>
      AtomRegistry.make({
        scheduleTask: (task) => {
          tasks.add(task);
          return () => tasks.delete(task);
        },
      }),
    ),
    (registry) => Effect.sync(() => registry.dispose()),
  );
  const drain = () => {
    while (tasks.size > 0) {
      const task = tasks.values().next().value!;
      tasks.delete(task);
      task();
    }
  };
  return { runtime, registry, drain, responseGate, requests: () => requests };
});

describe("review query caching", () => {
  it.effect(
    "revalidates an inactive staged scope after staging while keeping its cached value",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { runtime, registry, drain, responseGate, requests } = yield* makeReviewRuntime();
          const review = createReviewEnvironmentAtoms(runtime);
          const stagedQuery = review.diffPreview(queryTarget);
          const unmount = registry.mount(stagedQuery);
          expect((yield* AtomRegistry.getResult(registry, stagedQuery)).sources[0]?.diff).toBe("");
          const initialRequests = requests();
          unmount();
          drain();
          const staging = yield* Effect.promise(() =>
            review.setFilesStaged.run(registry, {
              environmentId,
              input: { cwd: "/repo", filePaths: ["changed.txt"], staged: true },
            }),
          );
          expect(AsyncResult.isSuccess(staging)).toBe(true);
          responseGate.closeUnsafe();
          const stop = registry.mount(stagedQuery);
          const cached = registry.get(stagedQuery);
          expect(Option.getOrThrow(AsyncResult.value(cached)).sources[0]?.diff).toBe("");
          responseGate.openUnsafe();
          const result = yield* AtomRegistry.getResult(registry, stagedQuery, {
            suspendOnWaiting: true,
          });
          expect(result.sources[0]?.diff).toBe("staged changes");
          expect(requests()).toBe(initialRequests + 1);
          stop();
        }),
      ),
  );

  it.effect("preserves fresh query caches across remounts and keeps manual refresh forceful", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { runtime, registry, drain, requests } = yield* makeReviewRuntime();
        const query = createEnvironmentRpcQueryAtomFamily(runtime, {
          label: "test:cached-review",
          tag: WS_METHODS.reviewGetDiffPreview,
          staleTimeMs: 60_000,
        })(queryTarget);
        const unmount = registry.mount(query);
        const first = yield* AtomRegistry.getResult(registry, query);
        unmount();
        drain();
        const stop = registry.mount(query);
        expect(yield* AtomRegistry.getResult(registry, query)).toBe(first);
        expect(requests()).toBe(1);
        const stopSecond = registry.mount(query);
        expect(requests()).toBe(1);
        registry.refresh(query);
        yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true });
        expect(requests()).toBe(2);
        stopSecond();
        stop();
      }),
    ),
  );
});
