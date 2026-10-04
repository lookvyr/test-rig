import { EventId, MessageId, RunId, type OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  BASE_PROJECTION,
  THREAD_ID,
  makeHarness,
  awaitThreadState,
  titleUpdated,
  deleted,
} from "./threadStateTestHarness.ts";

const olderItem = {
  id: "older-item",
  threadId: THREAD_ID,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: null,
  startedAt: "2026-06-20T00:00:00.000Z",
  completedAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  type: "command_execution",
  input: "pwd",
  output: "old",
  exitCode: 0,
};
const page = {
  snapshotSequence: 10,
  items: [
    {
      position: 0,
      visibility: "local",
      sourceThreadId: THREAD_ID,
      sourceItemId: olderItem.id,
      item: olderItem,
    },
  ],
  nextCursor: null,
  hasMoreHistory: false,
};
const bounded = (cursor = "first", sequence = 10) => ({
  kind: "snapshot" as const,
  snapshotSequence: sequence,
  projection: BASE_PROJECTION,
  historyCursor: cursor,
  hasMoreHistory: true,
  latestLocalTurnOrdinal: 2,
  payloadBudgetExceeded: false,
});
const pagingHarness = Effect.fn(function* () {
  const requested = yield* Deferred.make<void>();
  const response = yield* Deferred.make<Response>();
  const harness = yield* makeHarness({
    historyHttpClient: HttpClient.make((request, url) => {
      expect(url.searchParams.get("cursor")).toBe("first");
      return Deferred.succeed(requested, undefined).pipe(
        Effect.andThen(Deferred.await(response)),
        Effect.map((value) => HttpClientResponse.fromWeb(request, value)),
      );
    }),
  });
  yield* Queue.offer(harness.inputs, bounded());
  yield* awaitThreadState(
    harness.observed,
    (state) => state.status === "live" && state.history.historyCursor === "first",
  );
  return { ...harness, requested, response };
});

describe("native progressive history", () => {
  it.effect("loads an older page without replacing concurrent live state", () =>
    Effect.gen(function* () {
      const h = yield* pagingHarness();
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(h.requested);
      expect(yield* h.loadEarlier()).toEqual({ _tag: "busy" });
      yield* Queue.offer(h.inputs, titleUpdated("Updated while paging", 11));
      yield* awaitThreadState(
        h.observed,
        (state) => Option.getOrNull(state.data)?.thread.title === "Updated while paging",
      );
      yield* Deferred.succeed(h.response, Response.json({ ...page, snapshotSequence: 11 }));
      expect(yield* Fiber.join(loading)).toEqual({ _tag: "loaded" });
      const current = yield* SubscriptionRef.get(h.threadState);
      expect(Option.getOrThrow(current.data).thread.title).toBe("Updated while paging");
      expect(
        Option.getOrThrow(current.data).visibleTurnItems.map((row) => row.sourceItemId),
      ).toEqual(["older-item"]);
      expect(current.history).toMatchObject({
        hasMoreHistory: false,
        historyCursor: null,
        loading: false,
        expanded: true,
      });
      expect(yield* h.loadEarlier()).toEqual({ _tag: "noop" });
    }),
  );

  it.effect("rejects a stale page without consuming its cursor", () =>
    Effect.gen(function* () {
      const h = yield* pagingHarness();
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(h.requested);
      yield* Deferred.succeed(h.response, Response.json({ ...page, snapshotSequence: 9 }));
      expect(yield* Fiber.join(loading)).toEqual({ _tag: "noop" });
      const current = yield* SubscriptionRef.get(h.threadState);
      expect(current.history).toMatchObject({
        historyCursor: "first",
        hasMoreHistory: true,
        loading: false,
      });
      expect(Option.getOrThrow(current.data).visibleTurnItems).toEqual([]);
    }),
  );

  it.effect("does not restore unloaded history after a rollback and allows a fresh retry", () =>
    Effect.gen(function* () {
      const requested = yield* Deferred.make<void>();
      const response = yield* Deferred.make<Response>();
      let calls = 0;
      const h = yield* makeHarness({
        historyHttpClient: HttpClient.make((request) => {
          calls += 1;
          return (
            calls === 1
              ? Deferred.succeed(requested, undefined).pipe(
                  Effect.andThen(Deferred.await(response)),
                )
              : Effect.succeed(Response.json({ ...page, snapshotSequence: 11, items: [] }))
          ).pipe(Effect.map((value) => HttpClientResponse.fromWeb(request, value)));
        }),
      });
      const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
      const run: OrchestrationV2Run = {
        id: RunId.make("rolled-back-run"),
        threadId: THREAD_ID,
        ordinal: 1,
        providerInstanceId: BASE_PROJECTION.thread.providerInstanceId,
        modelSelection: BASE_PROJECTION.thread.modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("user"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      };
      yield* Queue.offer(h.inputs, {
        ...bounded(),
        projection: { ...BASE_PROJECTION, runs: [run] },
      });
      yield* awaitThreadState(
        h.observed,
        (state) => state.status === "live" && state.history.historyCursor === "first",
      );
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(requested);
      yield* Queue.offer(h.inputs, {
        kind: "event",
        sequence: 11,
        event: {
          id: EventId.make("rollback"),
          type: "run.updated",
          threadId: THREAD_ID,
          runId: run.id,
          occurredAt: now,
          payload: { ...run, status: "rolled_back" },
        },
      });
      yield* awaitThreadState(
        h.observed,
        (state) => Option.getOrNull(state.data)?.runs[0]?.status === "rolled_back",
      );
      yield* Deferred.succeed(
        response,
        Response.json({
          ...page,
          items: page.items.map((row) => ({ ...row, item: { ...row.item, runId: run.id } })),
        }),
      );
      expect(yield* Fiber.join(loading)).toEqual({ _tag: "noop" });
      const current = yield* SubscriptionRef.get(h.threadState);
      expect(Option.getOrThrow(current.data).visibleTurnItems).toEqual([]);
      expect(current.history).toMatchObject({
        historyCursor: "first",
        hasMoreHistory: true,
        loading: false,
      });
      expect(yield* h.loadEarlier()).toEqual({ _tag: "loaded" });
      expect((yield* SubscriptionRef.get(h.threadState)).history.hasMoreHistory).toBe(false);
    }),
  );

  it.effect("discards a page when a replacement snapshot changes the cursor", () =>
    Effect.gen(function* () {
      const h = yield* pagingHarness();
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(h.requested);
      yield* Queue.offer(h.inputs, bounded("replacement", 20));
      yield* awaitThreadState(h.observed, (state) => state.history.historyCursor === "replacement");
      yield* Deferred.succeed(h.response, Response.json(page));
      expect(yield* Fiber.join(loading)).toEqual({ _tag: "noop" });
      const current = yield* SubscriptionRef.get(h.threadState);
      expect(current.history.historyCursor).toBe("replacement");
      expect(Option.getOrThrow(current.data).visibleTurnItems).toEqual([]);
    }),
  );

  it.effect("does not resurrect a deleted thread from an in-flight page", () =>
    Effect.gen(function* () {
      const h = yield* pagingHarness();
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(h.requested);
      yield* Queue.offer(h.inputs, deleted(11));
      yield* awaitThreadState(h.observed, (state) => state.status === "deleted");
      yield* Deferred.succeed(h.response, Response.json(page));
      expect(yield* Fiber.join(loading)).toEqual({ _tag: "noop" });
      expect((yield* SubscriptionRef.get(h.threadState)).status).toBe("deleted");
    }),
  );

  it.effect("keeps the cursor retryable after a page error without failing the live stream", () =>
    Effect.gen(function* () {
      const h = yield* pagingHarness();
      const loading = yield* h.loadEarlier().pipe(Effect.forkScoped);
      yield* Deferred.await(h.requested);
      yield* Deferred.succeed(h.response, new Response("Unavailable", { status: 503 }));
      expect((yield* Fiber.join(loading))._tag).toBe("error");
      const current = yield* SubscriptionRef.get(h.threadState);
      expect(current.status).toBe("live");
      expect(current.history).toMatchObject({
        historyCursor: "first",
        loading: false,
        hasMoreHistory: true,
      });
      expect(current.history.error).not.toBeNull();
    }),
  );
});
