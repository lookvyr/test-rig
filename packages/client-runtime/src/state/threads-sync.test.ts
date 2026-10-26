import {
  ThreadId,
  EventId,
  MessageId,
  TurnItemId,
  type OrchestrationV2ThreadDetailSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { pendingBackgroundTurnItems } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { EMPTY_THREAD_HISTORY_META } from "./threadHistoryMerge.ts";
import * as Persistence from "../platform/persistence.ts";
import type { EnvironmentThreadState } from "./threadState.ts";
import { makeEnvironmentThreadState } from "./threads.ts";

import {
  THREAD_ID,
  CACHED_SNAPSHOT_SEQUENCE,
  BASE_PROJECTION,
  awaitThreadState,
  makeHarness,
  snapshot,
  synchronized,
  titleUpdated,
  deleted,
} from "./threadStateTestHarness.ts";

describe("EnvironmentThreads", () => {
  for (const source of ["disk", "HTTP"] as const) {
    it.effect(`does not rewrite an unchanged ${source} snapshot on navigation or warm return`, () =>
      Effect.gen(function* () {
        const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
          snapshot: undefined,
          owner: undefined,
        };
        const firstSaved = yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* makeHarness({
              resumeCache,
              ...(source === "disk"
                ? { cached: BASE_PROJECTION }
                : {
                    httpSnapshot: {
                      _tag: "present",
                      snapshot: { snapshotSequence: 7, projection: BASE_PROJECTION },
                    },
                  }),
            });
            yield* awaitThreadState(h.observed, (value) => value.status === "live");
            if (source === "HTTP") yield* TestClock.adjust("500 millis");
            return h.savedThreads;
          }),
        );
        expect(yield* Ref.get(firstSaved)).toHaveLength(source === "disk" ? 0 : 1);
        const nextSaved = yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* makeHarness({ resumeCache });
            yield* awaitThreadState(h.observed, (value) => value.status === "live");
            return h.savedThreads;
          }),
        );
        expect(yield* Ref.get(nextSaved)).toEqual([]);
      }),
    );
  }

  it.effect("persists a complete bounded HTTP window only once", () =>
    Effect.gen(function* () {
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const h = yield* makeHarness({
            httpSnapshot: {
              _tag: "present",
              snapshot: { snapshotSequence: 7, projection: BASE_PROJECTION },
              history: {
                historyCursor: null,
                hasMoreHistory: false,
                latestLocalTurnOrdinal: 12,
              },
            },
          });
          yield* awaitThreadState(h.observed, (value) => value.status === "live");
          yield* TestClock.adjust("500 millis");
          return h.savedThreads;
        }),
      );
      expect(yield* Ref.get(saved)).toEqual([
        {
          snapshotSequence: 7,
          projection: BASE_PROJECTION,
          historyCursor: null,
          hasMoreHistory: false,
          latestLocalTurnOrdinal: 12,
        },
      ]);
    }),
  );

  it.effect("retries a failed background cache write when the scope closes", () =>
    Effect.gen(function* () {
      let attempts = 0;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const h = yield* makeHarness({
            httpSnapshot: {
              _tag: "present",
              snapshot: { snapshotSequence: 7, projection: BASE_PROJECTION },
            },
            saveThread: () =>
              Effect.suspend(() => {
                attempts += 1;
                return attempts === 1
                  ? Effect.fail(
                      new Persistence.ConnectionPersistenceError({
                        operation: "save-thread",
                        message: "Test storage failure",
                      }),
                    )
                  : Effect.void;
              }),
          });
          yield* awaitThreadState(h.observed, (value) => value.status === "live");
          yield* TestClock.adjust("500 millis");
          expect(attempts).toBe(1);
        }),
      );
      expect(attempts).toBe(2);
    }),
  );

  it.effect("flushes newer data after an older background write completes", () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>();
      const written = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const h = yield* makeHarness({
            cached: BASE_PROJECTION,
            saveThread: (_environmentId, snapshot) =>
              snapshot.snapshotSequence === 8
                ? Deferred.succeed(writing, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(Deferred.succeed(written, undefined)),
                  )
                : Effect.void,
          });
          yield* Queue.offer(h.inputs, titleUpdated("First update", 8));
          yield* awaitThreadState(
            h.observed,
            (value) => Option.getOrNull(value.data)?.thread.title === "First update",
          );
          yield* TestClock.adjust("500 millis");
          yield* Deferred.await(writing);
          yield* Queue.offer(h.inputs, titleUpdated("Newer update", 9));
          yield* awaitThreadState(
            h.observed,
            (value) => Option.getOrNull(value.data)?.thread.title === "Newer update",
          );
          yield* Deferred.succeed(release, undefined);
          yield* Deferred.await(written);
          return h.savedThreads;
        }),
      );
      expect(
        (yield* Ref.get(saved)).map((snapshot) => [
          snapshot.snapshotSequence,
          snapshot.projection.thread.title,
        ]),
      ).toEqual([
        [8, "First update"],
        [9, "Newer update"],
      ]);
    }),
  );

  it.effect("does not resume past a canceled event whose data was not applied", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const first = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: {
            projection: BASE_PROJECTION,
            snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
          },
        },
        resumeCache,
      }).pipe(Effect.provideService(Scope.Scope, scope));
      yield* awaitThreadState(first.observed, (value) => value.status === "live");
      const applying = yield* Deferred.make<void>();
      const update = titleUpdated("Not applied", 8);
      if (update.kind !== "event") return yield* Effect.die("Expected an event");
      let sequenceReads = 0;
      Object.defineProperty(update, "sequence", {
        get: () => {
          if (++sequenceReads === 2) Deferred.doneUnsafe(applying, Exit.void);
          return 8;
        },
      });
      // Hold the projection write while the event advances its cursor. Closing
      // the scope must resume from the last fully applied projection.
      yield* first.threadState.semaphore.take(1);
      yield* Queue.offer(first.inputs, update);
      yield* Deferred.await(applying);
      yield* Scope.close(scope, Exit.void);
      yield* first.threadState.semaphore.release(1);

      const resumed = yield* makeHarness({ resumeCache });
      const state = yield* awaitThreadState(resumed.observed, (value) => value.status === "live");
      expect(Option.getOrThrow(state.data).thread.title).toBe(BASE_PROJECTION.thread.title);
      expect(yield* Ref.get(resumed.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(yield* Ref.get(first.savedThreads)).toEqual([
        {
          projection: BASE_PROJECTION,
          snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
          historyCursor: null,
          hasMoreHistory: false,
          latestLocalTurnOrdinal: null,
        },
      ]);
    }),
  );

  it.effect("prevents an old scope from replacing its successor's cached data", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      const oldScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const old = yield* makeHarness({ cached: BASE_PROJECTION, resumeCache }).pipe(
        Effect.provideService(Scope.Scope, oldScope),
      );
      yield* awaitThreadState(old.observed, (value) => value.status === "live");
      const successor = yield* makeHarness({ resumeCache });
      yield* Queue.offer(successor.inputs, titleUpdated("Successor title", 9));
      yield* awaitThreadState(
        successor.observed,
        (value) => Option.getOrNull(value.data)?.thread.title === "Successor title",
      );
      yield* Queue.offer(old.inputs, titleUpdated("Old scope title", 8));
      yield* awaitThreadState(
        old.observed,
        (value) => Option.getOrNull(value.data)?.thread.title === "Old scope title",
      );
      yield* Scope.close(oldScope, Exit.void);

      expect(resumeCache.snapshot?.sequence).toBe(9);
      expect(Option.getOrThrow(resumeCache.snapshot!.state.data).thread.title).toBe(
        "Successor title",
      );
      expect(yield* Ref.get(old.savedThreads)).toEqual([]);
    }),
  );

  it.effect("does not let a delayed cache read replace an initialized successor", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      const loading = yield* Deferred.make<void>();
      const response = yield* Deferred.make<Option.Option<OrchestrationV2ThreadDetailSnapshot>>();
      const oldFiber = yield* makeHarness({
        resumeCache,
        loadCached: Deferred.succeed(loading, undefined).pipe(
          Effect.andThen(Deferred.await(response)),
        ),
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(loading);
      const successor = yield* makeHarness({ cached: BASE_PROJECTION, resumeCache });
      yield* awaitThreadState(successor.observed, (value) => value.status === "live");
      yield* Deferred.succeed(
        response,
        Option.some({
          snapshotSequence: 3,
          projection: {
            ...BASE_PROJECTION,
            thread: { ...BASE_PROJECTION.thread, title: "Old disk data" },
          },
        }),
      );
      const old = yield* Fiber.join(oldFiber);
      yield* awaitThreadState(old.observed, (value) => value.status === "live");

      expect(resumeCache.snapshot?.sequence).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(Option.getOrThrow(resumeCache.snapshot!.state.data).thread.title).toBe(
        BASE_PROJECTION.thread.title,
      );
    }),
  );

  it.effect("does not let an old deletion remove its successor's persisted cache", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      const old = yield* makeHarness({ cached: BASE_PROJECTION, resumeCache });
      yield* awaitThreadState(old.observed, (value) => value.status === "live");
      const successor = yield* makeHarness({ resumeCache });
      yield* Queue.offer(successor.inputs, titleUpdated("Successor title", 9));
      yield* awaitThreadState(
        successor.observed,
        (value) => Option.getOrNull(value.data)?.thread.title === "Successor title",
      );
      const update = deleted();
      if (update.kind !== "event") return yield* Effect.die("Expected an event");
      yield* Queue.offer(old.inputs, { ...update, sequence: 8 });
      yield* awaitThreadState(old.observed, (value) => value.status === "deleted");

      expect(resumeCache.snapshot?.sequence).toBe(9);
      expect(yield* Ref.get(old.removedThreads)).toEqual([]);
    }),
  );

  it.effect("retains a deletion instead of restoring the old disk snapshot", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* makeHarness({ cached: BASE_PROJECTION, resumeCache });
          const update = deleted();
          if (update.kind !== "event") return yield* Effect.die("Expected an event");
          yield* Queue.offer(first.inputs, { ...update, sequence: 8 });
          yield* awaitThreadState(first.observed, (value) => value.status === "deleted");
        }),
      );
      const resumed = yield* makeHarness({ cached: BASE_PROJECTION, resumeCache });
      const state = yield* awaitThreadState(
        resumed.observed,
        (value) => value.status === "deleted",
      );
      expect(Option.isNone(state.data)).toBe(true);
      expect(yield* Ref.get(resumed.loaderCalls)).toBe(0);
    }),
  );

  it.effect("publishes cached data immediately from a warm cache", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      const state = yield* awaitThreadState(harness.observed, (value) => Option.isSome(value.data));

      expect(Option.getOrThrow(state.data)).toEqual(BASE_PROJECTION);
      expect(Option.isNone(state.error)).toBe(true);
    }),
  );

  it.effect("resumes a warm cache via afterSequence without an HTTP fetch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });

      // The warm cache reaches live from the cached data, and a live event
      // applies on top of it.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", CACHED_SNAPSHOT_SEQUENCE + 1));
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live title",
      );

      // The subscription resumed from the cached sequence and never fetched the
      // full snapshot over HTTP.
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
    }),
  );

  it.effect("coalesces streaming cache writes and flushes the latest thread on teardown", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const harness = yield* makeHarness().pipe(Effect.provideService(Scope.Scope, scope));
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* awaitThreadState(harness.observed, (state) => state.status === "live");
      yield* TestClock.adjust("500 millis");
      expect(yield* Ref.get(harness.savedThreads)).toHaveLength(1);

      for (let sequence = 2; sequence <= 10; sequence++) {
        yield* Queue.offer(harness.inputs, titleUpdated(`Title ${sequence}`, sequence));
        yield* awaitThreadState(
          harness.observed,
          (state) =>
            Option.isSome(state.data) && state.data.value.thread.title === `Title ${sequence}`,
        );
        yield* TestClock.adjust("1 second");
      }
      expect(yield* Ref.get(harness.savedThreads)).toHaveLength(1);
      yield* TestClock.adjust("1 second");
      expect((yield* Ref.get(harness.savedThreads)).map((saved) => saved.snapshotSequence)).toEqual(
        [1, 10],
      );

      yield* Queue.offer(harness.inputs, titleUpdated("Final title", 11));
      yield* awaitThreadState(
        harness.observed,
        (state) => Option.isSome(state.data) && state.data.value.thread.title === "Final title",
      );
      yield* Scope.close(scope, Exit.void);
      expect((yield* Ref.get(harness.savedThreads)).map((saved) => saved.snapshotSequence)).toEqual(
        [1, 10, 11],
      );
    }),
  );

  it.effect("reduces live events and persists the latest thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title"));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live title",
      );
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;

      expect(Option.getOrThrow(state.data).thread.title).toBe("Live title");
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.projection.thread.title).toBe(
        "Live title",
      );
      expect((yield* Ref.get(harness.savedThreads)).at(-1)?.snapshotSequence).toBe(2);
    }),
  );

  describe("Stop on cached work the server already finished (#18188)", () => {
    const at = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
    const parentThreadId = ThreadId.make("thread:parent");
    const command = (
      id: string,
      status: "running" | "completed",
      exitCode?: number,
      ordinal = id === "older-command" ? 1 : 2,
    ): OrchestrationV2TurnItem => ({
      id: TurnItemId.make(id),
      threadId: THREAD_ID,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status,
      title: null,
      startedAt: at,
      completedAt: status === "completed" ? at : null,
      updatedAt: at,
      type: "command_execution",
      input: `run ${id}`,
      output: "",
      ...(exitCode === undefined ? {} : { exitCode }),
    });
    const localRow = (item: OrchestrationV2TurnItem, position: number) => ({
      position,
      visibility: "local" as const,
      sourceThreadId: THREAD_ID,
      sourceItemId: item.id,
      item,
    });
    // A fork's parent row keeps its own source; the child's Stop must not touch it.
    const inheritedRow = {
      position: 0,
      visibility: "inherited" as const,
      sourceThreadId: parentThreadId,
      sourceItemId: TurnItemId.make("cached-command"),
      item: { ...command("cached-command", "running"), threadId: parentThreadId },
    };
    const cachedProjection = (items: ReadonlyArray<OrchestrationV2TurnItem>) => ({
      ...BASE_PROJECTION,
      turnItems: items,
      visibleTurnItems: [inheritedRow, ...items.map((item, index) => localRow(item, index + 1))],
    });
    // Loaded older history the bounded window would drop, next to the stale item.
    const cached: OrchestrationV2ThreadProjection = cachedProjection([
      command("older-command", "completed", 0),
      command("cached-command", "running"),
    ]);
    const cachedHistory = { historyCursor: "older", hasMoreHistory: true };
    const projectionStatuses = (projection: OrchestrationV2ThreadProjection) => ({
      items: projection.turnItems.map((item) => [String(item.id), item.status]),
      rows: projection.visibleTurnItems.map((row) => [
        row.visibility,
        String(row.sourceItemId),
        row.item.status,
      ]),
      pending: pendingBackgroundTurnItems(projection).map((item) => String(item.id)),
    });
    const statuses = (state: EnvironmentThreadState) =>
      projectionStatuses(Option.getOrThrow(state.data));
    const settledStatuses = {
      items: [
        ["older-command", "completed"],
        ["cached-command", "completed"],
      ],
      rows: [
        ["inherited", "cached-command", "running"],
        ["local", "older-command", "completed"],
        ["local", "cached-command", "completed"],
      ],
      pending: [],
    };
    const serverItems = (items: Record<string, OrchestrationV2TurnItem | null>) => ({
      getTurnItem: ({ itemId }: { readonly itemId: TurnItemId }) =>
        Effect.succeed({ item: items[itemId] ?? null }),
    });

    it.effect("settles an item the server finished without any new event, keeping history", () =>
      Effect.gen(function* () {
        const written = yield* Deferred.make<OrchestrationV2ThreadDetailSnapshot>();
        const harness = yield* makeHarness({
          cached,
          cachedHistory,
          saveThread: (_environmentId, thread) => Deferred.succeed(written, thread),
          ...serverItems({ "cached-command": command("cached-command", "completed", 0) }),
        });
        const before = yield* SubscriptionRef.get(harness.threadState);

        yield* harness.reconcilePendingWork;

        const after = yield* SubscriptionRef.get(harness.threadState);
        expect(statuses(after)).toEqual(settledStatuses);
        const settled = Option.getOrThrow(after.data);
        expect(settled.visibleTurnItems[0]).toBe(inheritedRow);
        expect(settled.visibleTurnItems[2]!.item).toBe(settled.turnItems[1]);
        expect(after.history).toEqual(before.history);
        yield* TestClock.adjust("500 millis");
        const saved = yield* Deferred.await(written);
        expect(projectionStatuses(saved.projection)).toEqual(settledStatuses);
        expect(saved).toMatchObject({ historyCursor: "older", hasMoreHistory: true });
      }),
    );

    it.effect("saves the repair after older history was loaded, without the expansion", () =>
      Effect.gen(function* () {
        const evenOlder = command("even-older-command", "completed", 0, 0);
        const scope = yield* Scope.make();
        const harness = yield* makeHarness({
          cached,
          cachedHistory,
          historyHttpClient: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({
                  snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
                  items: [localRow(evenOlder, 0)],
                  nextCursor: null,
                  hasMoreHistory: false,
                }),
              ),
            ),
          ),
          ...serverItems({ "cached-command": command("cached-command", "completed", 0) }),
        }).pipe(Scope.provide(scope));
        expect(yield* harness.loadEarlier()).toEqual({ _tag: "loaded" });
        expect((yield* SubscriptionRef.get(harness.threadState)).history.expanded).toBe(true);

        yield* harness.reconcilePendingWork;
        const after = yield* SubscriptionRef.get(harness.threadState);
        expect(after.history).toMatchObject({ expanded: true, historyCursor: null });
        expect(statuses(after).pending).toEqual([]);
        yield* TestClock.adjust("500 millis");
        yield* Scope.close(scope, Exit.void);

        const saved = (yield* Ref.get(harness.savedThreads)).at(-1);
        expect(saved).toMatchObject({
          snapshotSequence: CACHED_SNAPSHOT_SEQUENCE,
          historyCursor: "older",
          hasMoreHistory: true,
        });
        expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);

        const reloaded = yield* makeHarness({
          cached: saved!.projection,
          cachedHistory: { historyCursor: saved!.historyCursor!, hasMoreHistory: true },
        });
        expect(statuses(yield* SubscriptionRef.get(reloaded.threadState))).toEqual(settledStatuses);
      }),
    );

    const expandedHarness = Effect.fn("expandedHarness")(function* (
      scope: Scope.Closeable,
      options?: Pick<NonNullable<Parameters<typeof makeHarness>[0]>, "getTurnItem">,
    ) {
      const harness = yield* makeHarness({
        cached,
        cachedHistory,
        historyHttpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                snapshotSequence: CACHED_SNAPSHOT_SEQUENCE + 1,
                items: [localRow(command("even-older-command", "completed", 0, 0), 0)],
                nextCursor: null,
                hasMoreHistory: false,
              }),
            ),
          ),
        ),
        ...serverItems({ "cached-command": command("cached-command", "completed", 0) }),
        ...options,
      }).pipe(Scope.provide(scope));
      return harness;
    });
    const expand = (harness: Effect.Success<ReturnType<typeof expandedHarness>>) =>
      Effect.gen(function* () {
        expect(yield* harness.loadEarlier()).toEqual({ _tag: "loaded" });
        expect((yield* SubscriptionRef.get(harness.threadState)).history.expanded).toBe(true);
      });
    const lastSaved = (harness: Effect.Success<ReturnType<typeof expandedHarness>>) =>
      Ref.get(harness.savedThreads).pipe(Effect.map((saved) => saved.at(-1)));

    it.effect("saves an expanded thread's repair when its scope closes before the save runs", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const harness = yield* expandedHarness(scope);
        yield* expand(harness);

        yield* harness.reconcilePendingWork;
        yield* Scope.close(scope, Exit.void);

        const saved = yield* lastSaved(harness);
        expect(saved).toMatchObject({ historyCursor: "older", hasMoreHistory: true });
        expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);
      }),
    );

    it.effect(
      "saves an expanded thread's repair when its scope closes during the save cooldown",
      () =>
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const harness = yield* expandedHarness(scope);
          yield* Queue.offer(harness.inputs, titleUpdated("Renamed", CACHED_SNAPSHOT_SEQUENCE + 1));
          yield* awaitThreadState(
            harness.observed,
            (value) => Option.getOrThrow(value.data).thread.title === "Renamed",
          );
          yield* TestClock.adjust("500 millis");
          expect((yield* lastSaved(harness))?.projection.thread.title).toBe("Renamed");
          yield* expand(harness);

          yield* harness.reconcilePendingWork;
          yield* Scope.close(scope, Exit.void);

          const saved = yield* lastSaved(harness);
          expect(saved).toMatchObject({
            snapshotSequence: CACHED_SNAPSHOT_SEQUENCE + 1,
            historyCursor: "older",
            hasMoreHistory: true,
          });
          expect(saved!.projection.thread.title).toBe("Renamed");
          expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);
        }),
    );

    it.effect("saves a completion event that lands while the server is asked", () =>
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>();
        const answer = yield* Deferred.make<OrchestrationV2TurnItem>();
        const scope = yield* Scope.make();
        const harness = yield* expandedHarness(scope, {
          getTurnItem: () =>
            Deferred.succeed(asked, undefined).pipe(
              Effect.andThen(Deferred.await(answer)),
              Effect.map((item) => ({ item })),
            ),
        });
        yield* expand(harness);
        const reconciling = yield* harness.reconcilePendingWork.pipe(Effect.forkChild);
        yield* Deferred.await(asked);
        const fromEvent = command("cached-command", "completed", 1);
        yield* Queue.offer(harness.inputs, {
          kind: "event",
          sequence: CACHED_SNAPSHOT_SEQUENCE + 1,
          event: {
            id: EventId.make("event-cached-command-completed"),
            type: "turn-item.updated",
            threadId: THREAD_ID,
            occurredAt: at,
            payload: fromEvent,
          },
        });
        yield* awaitThreadState(harness.observed, (value) =>
          Option.getOrThrow(value.data).turnItems.some(
            (item) => item.id === fromEvent.id && item.status === "completed",
          ),
        );

        yield* Deferred.succeed(answer, command("cached-command", "completed", 0));
        yield* Fiber.join(reconciling);
        yield* Scope.close(scope, Exit.void);

        const live = Option.getOrThrow((yield* SubscriptionRef.get(harness.threadState)).data);
        expect(live.turnItems.find((item) => item.id === fromEvent.id)).toEqual(fromEvent);
        const saved = yield* lastSaved(harness);
        expect(saved).toMatchObject({ historyCursor: "older", hasMoreHistory: true });
        expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);
        expect(saved!.projection.turnItems.find((item) => item.id === fromEvent.id)).toEqual(
          fromEvent,
        );
      }),
    );

    // The event is newer than any reply, so the saved copy follows it however the lookup ends.
    it.effect.each(["running", "missing", "timed out"] as const)(
      "saves a completion event that overtakes a %s lookup reply",
      (reply) =>
        Effect.gen(function* () {
          const asked = yield* Deferred.make<void>();
          const answer = yield* Deferred.make<void>();
          const scope = yield* Scope.make();
          const harness = yield* expandedHarness(scope, {
            getTurnItem: () =>
              Deferred.succeed(asked, undefined).pipe(
                Effect.andThen(reply === "timed out" ? Effect.never : Deferred.await(answer)),
                Effect.as({
                  item: reply === "running" ? command("cached-command", "running") : null,
                }),
              ),
          });
          yield* expand(harness);
          const reconciling = yield* harness.reconcilePendingWork.pipe(Effect.forkChild);
          yield* Deferred.await(asked);
          const fromEvent = command("cached-command", "completed", 1);
          yield* Queue.offer(harness.inputs, {
            kind: "event",
            sequence: CACHED_SNAPSHOT_SEQUENCE + 1,
            event: {
              id: EventId.make("event-cached-command-completed"),
              type: "turn-item.updated",
              threadId: THREAD_ID,
              occurredAt: at,
              payload: fromEvent,
            },
          });
          yield* awaitThreadState(harness.observed, (value) =>
            Option.getOrThrow(value.data).turnItems.some(
              (item) => item.id === fromEvent.id && item.status === "completed",
            ),
          );

          if (reply === "timed out") yield* TestClock.adjust("10 seconds");
          else yield* Deferred.succeed(answer, undefined);
          yield* Fiber.join(reconciling);
          yield* Scope.close(scope, Exit.void);

          const saved = yield* lastSaved(harness);
          expect(saved).toMatchObject({ historyCursor: "older", hasMoreHistory: true });
          expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);
          expect(saved!.projection.turnItems.find((item) => item.id === fromEvent.id)).toEqual(
            fromEvent,
          );
        }),
    );

    it.effect("saves the repair for an expanded thread resumed in the same session", () =>
      Effect.gen(function* () {
        const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
          snapshot: {
            state: {
              data: Option.some(cached),
              status: "cached",
              error: Option.none(),
              history: { ...EMPTY_THREAD_HISTORY_META, historyCursor: null, expanded: true },
            },
            sequence: CACHED_SNAPSHOT_SEQUENCE,
            persisted: true,
          },
          owner: undefined,
        };
        const scope = yield* Scope.make();
        const harness = yield* makeHarness({
          cached,
          cachedHistory,
          resumeCache,
          ...serverItems({ "cached-command": command("cached-command", "completed", 0) }),
        }).pipe(Scope.provide(scope));

        yield* harness.reconcilePendingWork;
        yield* TestClock.adjust("500 millis");
        yield* Scope.close(scope, Exit.void);

        const saved = (yield* Ref.get(harness.savedThreads)).at(-1);
        expect(saved).toMatchObject({ historyCursor: "older", hasMoreHistory: true });
        expect(projectionStatuses(saved!.projection)).toEqual(settledStatuses);
      }),
    );

    it.effect("gives up on a lookup the server never answers, settling the rest", () =>
      Effect.gen(function* () {
        const askedCached = yield* Deferred.make<void>();
        const askedSilent = yield* Deferred.make<void>();
        const harness = yield* makeHarness({
          cached: cachedProjection([...cached.turnItems, command("silent-command", "running")]),
          cachedHistory,
          getTurnItem: ({ itemId }) =>
            itemId === "silent-command"
              ? Deferred.succeed(askedSilent, undefined).pipe(Effect.andThen(Effect.never))
              : Deferred.succeed(askedCached, undefined).pipe(
                  Effect.as({ item: command("cached-command", "completed", 0) }),
                ),
        });
        const reconciling = yield* harness.reconcilePendingWork.pipe(Effect.forkChild);
        yield* Deferred.await(askedCached);
        yield* Deferred.await(askedSilent);

        yield* TestClock.adjust("10 seconds");

        expect(reconciling.pollUnsafe()).toEqual(Exit.void);
        expect(statuses(yield* SubscriptionRef.get(harness.threadState)).items).toEqual([
          ["older-command", "completed"],
          ["cached-command", "completed"],
          ["silent-command", "running"],
        ]);
      }),
    );

    it.effect("keeps items the server still runs or does not return", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          cached: cachedProjection([...cached.turnItems, command("missing-command", "running")]),
          cachedHistory,
          ...serverItems({ "cached-command": command("cached-command", "running") }),
        });

        yield* harness.reconcilePendingWork;

        expect(statuses(yield* SubscriptionRef.get(harness.threadState)).items).toEqual([
          ["older-command", "completed"],
          ["cached-command", "running"],
          ["missing-command", "running"],
        ]);
      }),
    );

    it.effect("keeps events that land while the server is asked", () =>
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>();
        const answer = yield* Deferred.make<OrchestrationV2TurnItem>();
        const harness = yield* makeHarness({
          cached,
          cachedHistory,
          getTurnItem: () =>
            Deferred.succeed(asked, undefined).pipe(
              Effect.andThen(Deferred.await(answer)),
              Effect.map((item) => ({ item })),
            ),
        });
        const reconciling = yield* harness.reconcilePendingWork.pipe(Effect.forkChild);
        yield* Deferred.await(asked);
        yield* Queue.offer(harness.inputs, titleUpdated("Renamed", CACHED_SNAPSHOT_SEQUENCE + 1));
        yield* awaitThreadState(
          harness.observed,
          (value) => Option.getOrThrow(value.data).thread.title === "Renamed",
        );

        yield* Deferred.succeed(answer, command("cached-command", "completed", 0));
        yield* Fiber.join(reconciling);

        const after = yield* SubscriptionRef.get(harness.threadState);
        expect(Option.getOrThrow(after.data).thread.title).toBe("Renamed");
        expect(statuses(after)).toEqual(settledStatuses);
      }),
    );
  });

  it.effect("keeps progressive history metadata from a bounded socket fallback", () =>
    Effect.gen(function* () {
      const olderItem = {
        id: "item:older",
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
        output: "older history",
        exitCode: 0,
      };
      const harness = yield* makeHarness({
        historyHttpClient: HttpClient.make((request, url) => {
          expect(url.searchParams.get("cursor")).toBe("socket-history-cursor");
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                snapshotSequence: 14,
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
              }),
            ),
          );
        }),
      });
      yield* Queue.offer(harness.inputs, {
        kind: "snapshot",
        snapshotSequence: 14,
        projection: BASE_PROJECTION,
        historyCursor: "socket-history-cursor",
        hasMoreHistory: true,
        latestLocalTurnOrdinal: 47,
      });

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" && value.history.historyCursor === "socket-history-cursor",
      );
      expect(state.history).toMatchObject({
        historyCursor: "socket-history-cursor",
        hasMoreHistory: true,
        loading: false,
        error: null,
        expanded: false,
        latestLocalTurnOrdinal: 47,
      });
      // A transient cold HTTP failure still requests a bounded socket snapshot.
      // Its cursor remains available for a later history request.
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBeUndefined();
      expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBe(true);

      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;
      expect((yield* Ref.get(harness.savedThreads)).at(-1)).toMatchObject({
        snapshotSequence: 14,
        historyCursor: "socket-history-cursor",
        hasMoreHistory: true,
        latestLocalTurnOrdinal: 47,
      });
      expect(yield* harness.loadEarlier()).toEqual({ _tag: "loaded" });
      const expanded = yield* SubscriptionRef.get(harness.threadState);
      expect(
        Option.getOrThrow(expanded.data).turnItems.some((item) => item.id === olderItem.id),
      ).toBe(true);
      expect(expanded.history.hasMoreHistory).toBe(false);
    }),
  );

  it.effect("seeds the thread from the HTTP snapshot and resumes live events", () =>
    Effect.gen(function* () {
      const httpProjection: OrchestrationV2ThreadProjection = {
        ...BASE_PROJECTION,
        thread: { ...BASE_PROJECTION.thread, title: "HTTP title" },
      };
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: { snapshotSequence: 1, projection: httpProjection },
        },
      });
      // No socket snapshot is pushed; only a live event arrives over the socket.
      // It can only be applied if the HTTP snapshot already seeded the thread.
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).thread.title).toBe("Live title");
      // Cold cache: the full snapshot was loaded over HTTP and the socket
      // resumed from that snapshot's sequence.
      expect(yield* Ref.get(harness.loaderCalls)).toBeGreaterThanOrEqual(1);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(1);
      expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBe(true);
    }),
  );

  it.effect("installs bounded snapshot history meta and resumes via afterSequence", () =>
    Effect.gen(function* () {
      const httpProjection: OrchestrationV2ThreadProjection = {
        ...BASE_PROJECTION,
        thread: { ...BASE_PROJECTION.thread, title: "Bounded title" },
      };
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: { snapshotSequence: 11, projection: httpProjection },
          history: {
            historyCursor: "opaque-cursor",
            hasMoreHistory: true,
          },
        },
      });
      yield* Queue.offer(harness.inputs, titleUpdated("Live after bounded", 12));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live after bounded" &&
          value.history.hasMoreHistory,
      );

      expect(state.history).toMatchObject({
        historyCursor: "opaque-cursor",
        hasMoreHistory: true,
        loading: false,
        error: null,
        expanded: false,
      });
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(11);
      expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBe(true);
      // Bounded HTTP success must not require a socket snapshot frame.
      expect(Option.getOrThrow(state.data).thread.title).toBe("Live after bounded");
    }),
  );

  it.effect("persists progressive history meta with a settled bounded snapshot", () =>
    Effect.gen(function* () {
      const httpProjection: OrchestrationV2ThreadProjection = {
        ...BASE_PROJECTION,
        thread: { ...BASE_PROJECTION.thread, title: "Bounded cache title" },
      };
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: { snapshotSequence: 4, projection: httpProjection },
          history: {
            historyCursor: "cursor-oldest",
            hasMoreHistory: true,
          },
        },
      });
      // Bounded install alone (settled) must enqueue progressive meta with the
      // projection. Never persist the partial window as a complete full snapshot.
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Bounded cache title" &&
          value.history.historyCursor === "cursor-oldest",
      );
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;

      const savedAll = yield* Ref.get(harness.savedThreads);
      expect(savedAll.length).toBeGreaterThanOrEqual(1);
      const first = savedAll[0];
      expect(first?.snapshotSequence).toBe(4);
      expect(first?.projection.thread.title).toBe("Bounded cache title");
      expect(first?.historyCursor).toBe("cursor-oldest");
      expect(first?.hasMoreHistory).toBe(true);
      // No earlier complete-looking entry without progressive meta.
      expect(
        savedAll.some(
          (entry) =>
            entry.projection.thread.title === "Bounded cache title" &&
            entry.historyCursor === undefined &&
            entry.hasMoreHistory === undefined,
        ),
      ).toBe(false);

      // A later live update still carries the progressive cursor.
      yield* Queue.offer(harness.inputs, titleUpdated("Settled bounded", 5));
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Settled bounded",
      );
      yield* TestClock.adjust("10 seconds");
      yield* Effect.yieldNow;

      const saved = (yield* Ref.get(harness.savedThreads)).at(-1);
      expect(saved?.snapshotSequence).toBe(5);
      expect(saved?.projection.thread.title).toBe("Settled bounded");
      expect(saved?.historyCursor).toBe("cursor-oldest");
      expect(saved?.hasMoreHistory).toBe(true);
    }),
  );

  it.effect("warm resume restores progressive history meta and skips HTTP", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: {
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Cached bounded" },
        },
        cachedHistory: {
          historyCursor: "warm-cursor",
          hasMoreHistory: true,
        },
      });

      // Apply a live event so the subscription is known to have resumed from cache.
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Cached bounded live", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Cached bounded live" &&
          value.history.hasMoreHistory,
      );

      expect(state.history).toMatchObject({
        historyCursor: "warm-cursor",
        hasMoreHistory: true,
        expanded: false,
      });
      // Warm progressive cache must not re-download; resume via afterSequence.
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
      expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBe(true);
    }),
  );

  it.effect("legacy warm cache without history meta stays complete (no false load-earlier)", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      const state = yield* awaitThreadState(harness.observed, (value) => Option.isSome(value.data));
      expect(state.history).toMatchObject({
        historyCursor: null,
        hasMoreHistory: false,
        expanded: false,
      });
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
      expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBeUndefined();
    }),
  );

  for (const cacheKind of ["disk", "retained"] as const) {
    it.effect(`retains paging support through a complete bounded ${cacheKind} cache`, () =>
      Effect.gen(function* () {
        const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
          snapshot: undefined,
          owner: undefined,
        };
        const cold = yield* Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* makeHarness({
              resumeCache,
              httpSnapshot: {
                _tag: "present",
                snapshot: { snapshotSequence: 4, projection: BASE_PROJECTION },
                history: {
                  historyCursor: null,
                  hasMoreHistory: false,
                  latestLocalTurnOrdinal: null,
                },
              },
            });
            yield* Queue.offer(harness.inputs, titleUpdated("Complete bounded", 5));
            yield* awaitThreadState(
              harness.observed,
              (value) =>
                value.status === "live" &&
                Option.isSome(value.data) &&
                value.data.value.thread.title === "Complete bounded",
            );
            return harness;
          }),
        );
        const saved = (yield* Ref.get(cold.savedThreads)).at(-1);
        expect(saved).toMatchObject({
          snapshotSequence: 5,
          historyCursor: null,
          hasMoreHistory: false,
          latestLocalTurnOrdinal: null,
        });

        const warm = yield* makeHarness(
          cacheKind === "retained"
            ? { resumeCache }
            : { loadCached: Effect.succeed(Option.some(saved!)) },
        );
        // The thread may have grown past the replay budget while closed. Its
        // warm subscription must still allow the server to bound that fallback.
        yield* Queue.offer(warm.inputs, titleUpdated("Grown while closed", 200));
        yield* awaitThreadState(
          warm.observed,
          (value) =>
            value.status === "live" &&
            Option.isSome(value.data) &&
            value.data.value.thread.title === "Grown while closed",
        );
        expect(yield* Ref.get(warm.loaderCalls)).toBe(0);
        expect(yield* Ref.get(warm.lastSubscribeAfterSequence)).toBe(5);
        expect(yield* Ref.get(warm.lastAcceptBoundedSnapshot)).toBe(true);
      }),
    );
  }

  for (const historyPaging of ["no-http", "no-controller"] as const) {
    it.effect(`does not negotiate bounded fallbacks with ${historyPaging}`, () =>
      Effect.gen(function* () {
        for (const source of ["cache", "http"] as const) {
          const history = {
            historyCursor: "known-paging-cursor",
            hasMoreHistory: true,
          };
          const harness = yield* makeHarness({
            historyPaging,
            ...(source === "cache"
              ? { cached: BASE_PROJECTION, cachedHistory: history }
              : {
                  httpSnapshot: {
                    _tag: "present" as const,
                    snapshot: { snapshotSequence: 4, projection: BASE_PROJECTION },
                    history,
                  },
                }),
          });
          yield* Queue.offer(harness.inputs, titleUpdated("Paging unavailable", 10));
          yield* awaitThreadState(
            harness.observed,
            (value) =>
              value.status === "live" &&
              Option.isSome(value.data) &&
              value.data.value.thread.title === "Paging unavailable",
          );
          expect(yield* Ref.get(harness.lastAcceptBoundedSnapshot)).toBeUndefined();
        }
      }),
    );
  }

  it.effect("socket snapshot clears progressive history meta left from a bounded window", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: {
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Warm progressive" },
        },
        cachedHistory: {
          historyCursor: "stale-cursor",
          hasMoreHistory: true,
        },
      });

      yield* Queue.offer(
        harness.inputs,
        snapshot(
          {
            ...BASE_PROJECTION,
            thread: { ...BASE_PROJECTION.thread, title: "Full socket snapshot" },
          },
          CACHED_SNAPSHOT_SEQUENCE + 1,
        ),
      );

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Full socket snapshot" &&
          value.history.historyCursor === null &&
          value.history.hasMoreHistory === false,
      );

      expect(state.history).toMatchObject({
        historyCursor: null,
        hasMoreHistory: false,
        expanded: false,
        loading: false,
        error: null,
      });

      // Settled full snapshot persistence must not keep the stale cursor.
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;
      const saved = (yield* Ref.get(harness.savedThreads)).at(-1);
      expect(saved?.projection.thread.title).toBe("Full socket snapshot");
      expect(saved?.historyCursor).toBeNull();
      expect(saved?.hasMoreHistory).toBe(false);
    }),
  );

  it.effect("bounded socket fallback replaces progressive history meta during resume", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: {
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Warm progressive" },
        },
        cachedHistory: {
          historyCursor: "stale-cursor",
          hasMoreHistory: true,
          latestLocalTurnOrdinal: 3,
        },
      });

      yield* Queue.offer(harness.inputs, {
        ...snapshot(
          {
            ...BASE_PROJECTION,
            thread: { ...BASE_PROJECTION.thread, title: "Bounded resume fallback" },
          },
          CACHED_SNAPSHOT_SEQUENCE + 1,
        ),
        historyCursor: "replacement-cursor",
        hasMoreHistory: true,
        latestLocalTurnOrdinal: 9,
      });

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.getOrNull(value.data)?.thread.title === "Bounded resume fallback" &&
          value.history.historyCursor === "replacement-cursor",
      );

      expect(state.history).toMatchObject({
        historyCursor: "replacement-cursor",
        hasMoreHistory: true,
        latestLocalTurnOrdinal: 9,
        expanded: false,
        loading: false,
        error: null,
      });
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE);
    }),
  );

  it.effect("live events preserve progressive history meta under atomic setThread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: {
            snapshotSequence: 8,
            projection: {
              ...BASE_PROJECTION,
              thread: { ...BASE_PROJECTION.thread, title: "Bounded seed" },
            },
          },
          history: {
            historyCursor: "keep-me",
            hasMoreHistory: true,
          },
        },
      });

      yield* Queue.offer(harness.inputs, titleUpdated("Live preserves meta", 9));
      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live preserves meta",
      );

      expect(state.history).toMatchObject({
        historyCursor: "keep-me",
        hasMoreHistory: true,
        expanded: false,
      });
    }),
  );

  it.effect("bounded HTTP install sets projection and progressive meta atomically", () =>
    Effect.gen(function* () {
      // One setThread with explicit history (not applyItem reset + later meta).
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: {
            snapshotSequence: 2,
            projection: {
              ...BASE_PROJECTION,
              thread: { ...BASE_PROJECTION.thread, title: "Bounded atomic install" },
            },
          },
          history: {
            historyCursor: "post-install-cursor",
            hasMoreHistory: true,
          },
        },
      });

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Bounded atomic install" &&
          value.history.historyCursor === "post-install-cursor" &&
          value.history.hasMoreHistory === true,
      );

      expect(state.history).toMatchObject({
        historyCursor: "post-install-cursor",
        hasMoreHistory: true,
        loading: false,
        error: null,
        expanded: false,
      });
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(2);
    }),
  );

  it.effect("dropped partial-timeline turn item is a true applyItem no-op", () =>
    Effect.gen(function* () {
      const recent = {
        id: TurnItemId.make("item-window"),
        threadId: THREAD_ID,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 10,
        status: "completed" as const,
        title: null,
        startedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        completedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        type: "command_execution" as const,
        input: "pwd",
        output: "ok",
        exitCode: 0,
      } satisfies OrchestrationV2TurnItem;
      const recentRow = {
        position: 0,
        visibility: "local" as const,
        sourceThreadId: THREAD_ID,
        sourceItemId: recent.id,
        item: recent,
      };
      const boundedProjection: OrchestrationV2ThreadProjection = {
        ...BASE_PROJECTION,
        thread: { ...BASE_PROJECTION.thread, title: "Partial noop" },
        turnItems: [recent],
        visibleTurnItems: [recentRow],
      };
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: {
            snapshotSequence: 5,
            projection: boundedProjection,
            latestLocalTurnOrdinal: 10,
          },
          history: {
            historyCursor: "partial-cursor",
            hasMoreHistory: true,
            latestLocalTurnOrdinal: 10,
          },
        },
      });

      const seeded = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Partial noop" &&
          value.history.historyCursor === "partial-cursor",
      );
      const seededProjection = Option.getOrThrow(seeded.data);
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;
      const savedBefore = (yield* Ref.get(harness.savedThreads)).length;

      const older = {
        ...recent,
        id: TurnItemId.make("item-old-outside"),
        ordinal: 3,
        output: "must-not-append",
      } satisfies OrchestrationV2TurnItem;
      yield* Queue.offer(harness.inputs, {
        kind: "event",
        sequence: 6,
        event: {
          id: EventId.make("event-old-partial"),
          type: "turn-item.updated",
          threadId: THREAD_ID,
          occurredAt: DateTime.makeUnsafe("2026-06-20T01:00:00.000Z"),
          payload: older,
        },
      });

      // Allow the event to be processed without requiring a state transition.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        yield* Effect.yieldNow;
      }
      // Drive a later unrelated title update so we know the stream continued.
      yield* Queue.offer(harness.inputs, titleUpdated("After dropped event", 7));
      const after = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "After dropped event",
      );

      // The dropped event must not have appended the old item.
      expect(Option.getOrThrow(after.data).turnItems.map((item) => String(item.id))).toEqual([
        String(recent.id),
      ]);
      // Watermark unchanged (only advanced on successful newer turn-item applies).
      expect(after.history.latestLocalTurnOrdinal).toBe(10);
      // No persistence enqueue from the dropped event itself.
      const savedAfterDrop = (yield* Ref.get(harness.savedThreads)).length;
      expect(savedAfterDrop).toBe(savedBefore);
      // Seeded projection reference path: event path kept partial meta intact.
      expect(after.history.historyCursor).toBe("partial-cursor");
      expect(after.history.hasMoreHistory).toBe(true);
      // Title event applied; drop itself did not clear progressive meta.
      expect(seededProjection.turnItems.map((item) => String(item.id))).toEqual([
        String(recent.id),
      ]);
    }),
  );

  it.effect("installs and advances latestLocalTurnOrdinal for partial progressive windows", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: {
          _tag: "present",
          snapshot: {
            snapshotSequence: 3,
            projection: {
              ...BASE_PROJECTION,
              thread: { ...BASE_PROJECTION.thread, title: "Watermark seed" },
            },
            latestLocalTurnOrdinal: 15,
          },
          history: {
            historyCursor: "wm-cursor",
            hasMoreHistory: true,
            latestLocalTurnOrdinal: 15,
          },
        },
      });

      const seeded = yield* awaitThreadState(
        harness.observed,
        (value) =>
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Watermark seed" &&
          value.history.latestLocalTurnOrdinal === 15,
      );
      expect(seeded.history.latestLocalTurnOrdinal).toBe(15);

      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;
      const savedSeed = (yield* Ref.get(harness.savedThreads)).at(-1);
      expect(savedSeed?.latestLocalTurnOrdinal).toBe(15);

      const newer = {
        id: TurnItemId.make("item-newer-live"),
        threadId: THREAD_ID,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 22,
        status: "completed" as const,
        title: null,
        startedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        completedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
        type: "command_execution" as const,
        input: "echo newer",
        output: "newer",
        exitCode: 0,
      } satisfies OrchestrationV2TurnItem;

      yield* Queue.offer(harness.inputs, {
        kind: "event",
        sequence: 4,
        event: {
          id: EventId.make("event-newer-item"),
          type: "turn-item.updated",
          threadId: THREAD_ID,
          occurredAt: DateTime.makeUnsafe("2026-06-20T01:00:00.000Z"),
          payload: newer,
        },
      });

      const advanced = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.history.latestLocalTurnOrdinal === 22 &&
          value.data.value.turnItems.some((item) => String(item.id) === String(newer.id)),
      );
      expect(advanced.history.latestLocalTurnOrdinal).toBe(22);
      expect(advanced.history.historyCursor).toBe("wm-cursor");
    }),
  );

  it.effect("warm resume restores latestLocalTurnOrdinal from progressive cache", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        cached: {
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Warm watermark" },
        },
        cachedHistory: {
          historyCursor: "warm-wm-cursor",
          hasMoreHistory: true,
          latestLocalTurnOrdinal: 33,
        },
      });

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Warm watermark" &&
          value.history.latestLocalTurnOrdinal === 33,
      );
      expect(state.history).toMatchObject({
        historyCursor: "warm-wm-cursor",
        hasMoreHistory: true,
        latestLocalTurnOrdinal: 33,
        expanded: false,
      });
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);
    }),
  );

  it.effect("marks a cold definitive HTTP miss deleted without socket subscribe or retry", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: { _tag: "missing" },
      });

      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "deleted",
      );

      expect(Option.isNone(state.data)).toBe(true);
      expect(Option.isNone(state.error)).toBe(true);
      expect(yield* Ref.get(harness.loaderCalls)).toBeGreaterThanOrEqual(1);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([THREAD_ID]);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(0);

      // A definitive miss must not schedule the expected-failure retry path.
      yield* TestClock.adjust("1 second");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        yield* Effect.yieldNow;
      }
      yield* harness.replaceSession;
      yield* Queue.offer(harness.wakeups, "application-active");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(0);
      expect(yield* Ref.get(harness.retryCount)).toBe(0);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      expect((yield* Ref.get(harness.latest)).status).toBe("deleted");
    }),
  );

  it.effect("retains an HTTP miss across navigation but a fresh client can load the thread", () =>
    Effect.gen(function* () {
      const resumeCache: NonNullable<Parameters<typeof makeEnvironmentThreadState>[1]> = {
        snapshot: undefined,
        owner: undefined,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* makeHarness({ resumeCache, httpSnapshot: { _tag: "missing" } });
          yield* awaitThreadState(first.observed, (state) => state.status === "deleted");
        }),
      );

      // A draft lookup before creation has the same definitive 404 as a
      // deleted thread. Callers must wait for creation before loading details.
      const httpSnapshot = {
        _tag: "present" as const,
        snapshot: { snapshotSequence: 8, projection: BASE_PROJECTION },
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const returned = yield* makeHarness({ resumeCache, httpSnapshot });
          const state = yield* awaitThreadState(returned.observed, (s) => s.status === "deleted");
          expect(Option.isNone(state.data)).toBe(true);
          expect(yield* Ref.get(returned.loaderCalls)).toBe(0);
        }),
      );

      const reloaded = yield* makeHarness({ httpSnapshot });
      const state = yield* awaitThreadState(reloaded.observed, (s) => s.status === "live");
      expect(Option.getOrNull(state.data)).toBe(BASE_PROJECTION);
      expect(yield* Ref.get(reloaded.loaderCalls)).toBe(1);
    }),
  );

  it.effect("falls back to the socket when the HTTP snapshot is only unavailable", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: { _tag: "unavailable" },
      });

      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Socket title" },
        }),
      );

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Socket title",
      );

      expect(Option.getOrThrow(state.data).thread.title).toBe("Socket title");
      expect(yield* Ref.get(harness.loaderCalls)).toBeGreaterThanOrEqual(1);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([]);
    }),
  );

  it.effect("ignores replayed thread events at or below the snapshot sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* Queue.offer(harness.inputs, titleUpdated("Replayed title", 1));
      yield* Queue.offer(harness.inputs, titleUpdated("Live title", 2));

      const state = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Live title",
      );

      expect(Option.getOrThrow(state.data).thread.title).toBe("Live title");
    }),
  );

  it.effect("does not recreate a deleted cache from a queued save or finalizer", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const harness = yield* makeHarness().pipe(Effect.provideService(Scope.Scope, scope));
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");
      yield* TestClock.adjust("500 millis");
      expect(yield* Ref.get(harness.savedThreads)).toHaveLength(1);

      yield* Queue.offer(harness.inputs, titleUpdated("Queued before deletion"));
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          Option.isSome(value.data) && value.data.value.thread.title === "Queued before deletion",
      );
      yield* Queue.offer(harness.inputs, deleted());
      const state = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "deleted",
      );
      expect(Option.isNone(state.data)).toBe(true);
      expect(yield* Ref.get(harness.removedThreads)).toEqual([THREAD_ID]);

      yield* TestClock.adjust("10 seconds");
      expect(yield* Ref.get(harness.savedThreads)).toHaveLength(1);
      yield* Scope.close(scope, Exit.void);
      expect(yield* Ref.get(harness.savedThreads)).toHaveLength(1);
    }),
  );

  it.effect("preserves data after a domain failure and resumes on a replacement session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* Queue.offer(harness.inputs, new Error("stream failed"));

      const state = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );

      expect(Option.getOrThrow(state.data)).toEqual(BASE_PROJECTION);
      expect(Option.getOrThrow(state.error)).toBe("stream failed");
      expect(yield* Ref.get(harness.retryCount)).toBe(0);

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Recovered thread" },
        }),
      );
      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Recovered thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
    }),
  );

  it.effect("recovers from a transient domain failure without replacing the session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Queue.offer(harness.inputs, new Error("thread not found yet"));

      const failed = yield* awaitThreadState(harness.observed, (value) =>
        Option.isSome(value.error),
      );
      expect(Option.getOrThrow(failed.error)).toBe("thread not found yet");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(1);

      yield* TestClock.adjust("250 millis");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(
        harness.inputs,
        snapshot({
          ...BASE_PROJECTION,
          thread: { ...BASE_PROJECTION.thread, title: "Materialized thread" },
        }),
      );

      const recovered = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Materialized thread",
      );

      expect(Option.isNone(recovered.error)).toBe(true);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.retryCount)).toBe(0);
    }),
  );

  it.effect("does not overwrite a live snapshot when the supervisor becomes ready", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION });
      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      yield* Queue.offer(harness.inputs, snapshot(BASE_PROJECTION));
      yield* awaitThreadState(harness.observed, (value) => value.status === "live");

      yield* SubscriptionRef.set(harness.supervisorState, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 1,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      expect((yield* Ref.get(harness.latest)).status).toBe("live");
    }),
  );

  it.effect("keeps replayed updates synchronizing until the completion marker arrives", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION, completionMarker: true });
      yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);

      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Caught-up title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      const catchingUp = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "synchronizing" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Caught-up title",
      );
      expect(catchingUp.status).toBe("synchronizing");

      yield* Queue.offer(harness.inputs, synchronized());
      const live = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(live.data).thread.title).toBe("Caught-up title");
    }),
  );

  it.effect("skips an unknown event type and resumes after it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION, completionMarker: true });
      const unknown = (sequence: number): OrchestrationV2ThreadStreamItem => ({
        kind: "unknown-event",
        sequence,
        eventType: "run.from-a-future-server",
      });
      const occurredAt = DateTime.makeUnsafe("2026-06-20T01:00:00.000Z");
      yield* Queue.offerAll(harness.inputs, [
        {
          kind: "event",
          sequence: CACHED_SNAPSHOT_SEQUENCE + 1,
          event: {
            id: EventId.make("event-message"),
            type: "message.updated",
            threadId: THREAD_ID,
            occurredAt,
            payload: {
              id: MessageId.make("message-before"),
              threadId: THREAD_ID,
              runId: null,
              nodeId: null,
              role: "assistant",
              text: "Before",
              streaming: false,
              attachments: [],
              createdBy: "agent",
              creationSource: "provider",
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
          },
        },
        unknown(CACHED_SNAPSHOT_SEQUENCE + 2),
        titleUpdated("After", CACHED_SNAPSHOT_SEQUENCE + 3),
        // A trailing unknown event must still advance the resume cursor.
        unknown(CACHED_SNAPSHOT_SEQUENCE + 4),
        synchronized(),
      ]);
      const live = yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "After",
      );
      expect(Option.isNone(live.error)).toBe(true);
      expect(Option.getOrThrow(live.data).messages.map((message) => message.text)).toEqual([
        "Before",
      ]);

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 4);
    }),
  );

  it.effect("resumes replacement sessions from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Latest title",
      );

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect((yield* Ref.get(harness.latest)).status).toBe("synchronizing");
    }),
  );

  it.effect("resubscribes on app foreground from the latest applied sequence", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ cached: BASE_PROJECTION, completionMarker: true });
      yield* Queue.offer(
        harness.inputs,
        titleUpdated("Latest title", CACHED_SNAPSHOT_SEQUENCE + 1),
      );
      yield* Queue.offer(harness.inputs, synchronized());
      yield* awaitThreadState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.thread.title === "Latest title",
      );

      yield* Queue.offer(harness.wakeups, "application-active");
      const synchronizing = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "synchronizing" && Option.isSome(value.data),
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) break;
        yield* Effect.yieldNow;
      }

      expect(synchronizing.status).toBe("synchronizing");
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
      expect(yield* Ref.get(harness.lastSubscribeAfterSequence)).toBe(CACHED_SNAPSHOT_SEQUENCE + 1);
      expect(yield* Ref.get(harness.lastRequestCompletionMarker)).toBe(true);
      expect(yield* Ref.get(harness.loaderCalls)).toBe(0);

      yield* Queue.offer(harness.inputs, synchronized());
      const live = yield* awaitThreadState(
        harness.observed,
        (value) => value.status === "live" && Option.isSome(value.data),
      );
      expect(Option.getOrThrow(live.data).thread.title).toBe("Latest title");

      yield* Queue.offer(harness.wakeups, "application-active");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 3) break;
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(3);
    }),
  );
});
