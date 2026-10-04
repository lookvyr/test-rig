import {
  EnvironmentId,
  EventId,
  ORCHESTRATION_V2_WS_METHODS,
  ThreadId,
  type OrchestrationV2ThreadDetailSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadStreamItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import { v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import * as ThreadHistoryController from "./threadHistoryController.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  makeEnvironmentThreadState,
  type EnvironmentThreadState,
  type ThreadSnapshotLoadResult,
} from "./threads.ts";
import * as ThreadSnapshotLoader from "./threadSnapshotHttp.ts";

export const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
export const THREAD_ID = v2ThreadId;
export const CACHED_SNAPSHOT_SEQUENCE = 7;
export const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};
export const BASE_PROJECTION: OrchestrationV2ThreadProjection = {
  ...v2Projection,
  thread: { ...v2Projection.thread, title: "Cached thread" },
};

export type TestThreadInput = OrchestrationV2ThreadStreamItem | Error;

export function testSession(
  client: WsRpcProtocolClient,
  config?: { readonly completionMarker?: boolean },
): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.succeed(
      config?.completionMarker === true
        ? ({ threadResumeCompletionMarker: true } as never)
        : ({} as never),
    ),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

export function awaitThreadState(
  observed: Queue.Queue<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) {
  return Queue.take(observed).pipe(
    Effect.repeat({
      until: predicate,
    }),
  );
}

export const makeHarness = Effect.fn("TestEnvironmentThreads.makeHarness")(function* (options?: {
  readonly cached?: OrchestrationV2ThreadProjection;
  readonly cachedHistory?: {
    readonly historyCursor: string | null;
    readonly hasMoreHistory: boolean;
    readonly latestLocalTurnOrdinal?: number | null;
  };
  readonly httpSnapshot?: ThreadSnapshotLoadResult;
  readonly completionMarker?: boolean;
  readonly resumeCache?: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]>;
  readonly loadCached?: Effect.Effect<Option.Option<OrchestrationV2ThreadDetailSnapshot>>;
  readonly saveThread?: Persistence.EnvironmentCacheStore["Service"]["saveThread"];
  readonly historyPaging?: "enabled" | "no-http" | "no-controller";
  readonly historyHttpClient?: HttpClient.HttpClient;
}) {
  const inputs = yield* Queue.unbounded<TestThreadInput>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const latest = yield* Ref.make<EnvironmentThreadState>(EMPTY_ENVIRONMENT_THREAD_STATE);
  const retryCount = yield* Ref.make(0);
  const subscriptionCount = yield* Ref.make(0);
  const loaderCalls = yield* Ref.make(0);
  const lastSubscribeAfterSequence = yield* Ref.make<number | undefined>(undefined);
  const lastRequestCompletionMarker = yield* Ref.make(false);
  const lastAcceptBoundedSnapshot = yield* Ref.make<true | undefined>(undefined);
  const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>();
  const savedThreads = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadDetailSnapshot>>([]);
  const removedThreads = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const streamFrom = (queue: Queue.Queue<TestThreadInput>) =>
    Stream.fromQueue(queue).pipe(
      Stream.mapEffect((input) =>
        input instanceof Error ? Effect.fail(input) : Effect.succeed(input),
      ),
    );
  const client = {
    [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: (input: {
      readonly afterSequence?: number;
      readonly requestCompletionMarker?: true;
      readonly acceptBoundedSnapshot?: true;
    }) =>
      Stream.unwrap(
        Ref.updateAndGet(subscriptionCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(lastSubscribeAfterSequence, input.afterSequence)),
          Effect.andThen(
            Ref.set(lastRequestCompletionMarker, input.requestCompletionMarker === true),
          ),
          Effect.andThen(Ref.set(lastAcceptBoundedSnapshot, input.acceptBoundedSnapshot)),
          Effect.as(streamFrom(inputs)),
        ),
      ),
  } as unknown as WsRpcProtocolClient;
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(testSession(client, options)),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some(PREPARED),
  );
  const snapshotLoader = ThreadSnapshotLoader.ThreadSnapshotLoader.of({
    load: (_prepared, threadId) =>
      Ref.update(loaderCalls, (count) => count + 1).pipe(
        Effect.as(
          threadId === THREAD_ID
            ? (options?.httpSnapshot ??
                ({ _tag: "unavailable" } satisfies ThreadSnapshotLoadResult))
            : ({ _tag: "unavailable" } satisfies ThreadSnapshotLoadResult),
        ),
      ),
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Ref.update(retryCount, (count) => count + 1),
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: (_environmentId, threadId) =>
      options?.loadCached ??
      Effect.succeed(
        threadId === THREAD_ID && options?.cached !== undefined
          ? Option.some({
              snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
              projection: options.cached,
              ...(options.cachedHistory === undefined
                ? {}
                : {
                    historyCursor: options.cachedHistory.historyCursor,
                    hasMoreHistory: options.cachedHistory.hasMoreHistory,
                    ...(options.cachedHistory.latestLocalTurnOrdinal === undefined
                      ? {}
                      : {
                          latestLocalTurnOrdinal: options.cachedHistory.latestLocalTurnOrdinal,
                        }),
                  }),
            })
          : Option.none(),
      ),
    saveThread: (environmentId, thread) =>
      Ref.update(savedThreads, (current) => [...current, thread]).pipe(
        Effect.andThen(options?.saveThread?.(environmentId, thread) ?? Effect.void),
      ),
    removeThread: (_environmentId, threadId) =>
      Ref.update(removedThreads, (current) => [...current, threadId]),
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  let makeThreadState = makeEnvironmentThreadState(THREAD_ID, options?.resumeCache).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader.ThreadSnapshotLoader, snapshotLoader),
    Effect.provideService(
      ConnectionWakeups.ConnectionWakeups,
      ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromQueue(wakeups) }),
    ),
  );
  if (options?.historyPaging !== "no-http") {
    makeThreadState = makeThreadState.pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        options?.historyHttpClient ??
          HttpClient.make(() => Effect.die("Unexpected history HTTP request")),
      ),
    );
  }
  const historyController = yield* ThreadHistoryController.ThreadHistoryController.pipe(
    Effect.provide(ThreadHistoryController.layer),
  );
  if (options?.historyPaging !== "no-controller") {
    makeThreadState = makeThreadState.pipe(
      Effect.provideService(ThreadHistoryController.ThreadHistoryController, historyController),
    );
  }
  const threadState = yield* makeThreadState;
  yield* SubscriptionRef.changes(threadState).pipe(
    Stream.runForEach((state) =>
      Ref.set(latest, state).pipe(Effect.andThen(Queue.offer(observed, state))),
    ),
    Effect.forkScoped,
  );

  return {
    threadState,
    loadEarlier: () => historyController.loadEarlier(TARGET.environmentId, THREAD_ID),
    inputs,
    observed,
    latest,
    retryCount,
    subscriptionCount,
    loaderCalls,
    lastSubscribeAfterSequence,
    lastRequestCompletionMarker,
    lastAcceptBoundedSnapshot,
    supervisorState,
    supervisorSession,
    savedThreads,
    removedThreads,
    wakeups,
    replaceSession: SubscriptionRef.set(
      supervisorSession,
      Option.some(testSession(client, options)),
    ),
  };
});

export const snapshot = (
  projection: OrchestrationV2ThreadProjection,
  snapshotSequence = 1,
): Extract<OrchestrationV2ThreadStreamItem, { readonly kind: "snapshot" }> => ({
  kind: "snapshot",
  snapshotSequence,
  projection,
});

export const synchronized = (): OrchestrationV2ThreadStreamItem => ({ kind: "synchronized" });

export const titleUpdated = (title: string, sequence = 2): OrchestrationV2ThreadStreamItem => {
  const occurredAt = DateTime.makeUnsafe("2026-06-20T01:00:00.000Z");
  return {
    kind: "event",
    sequence,
    event: {
      id: EventId.make("event-title"),
      type: "thread.metadata-updated",
      threadId: THREAD_ID,
      occurredAt,
      payload: { ...v2Projection.thread, title, updatedAt: occurredAt },
    },
  };
};

export const deleted = (sequence = 3): OrchestrationV2ThreadStreamItem => {
  const occurredAt = DateTime.makeUnsafe("2026-06-20T02:00:00.000Z");
  return {
    kind: "event",
    sequence,
    event: {
      id: EventId.make("event-deleted"),
      type: "thread.deleted",
      threadId: THREAD_ID,
      occurredAt,
      payload: { ...v2Projection.thread, updatedAt: occurredAt, deletedAt: occurredAt },
    },
  };
};
