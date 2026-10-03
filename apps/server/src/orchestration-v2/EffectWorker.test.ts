import { assert, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";

it("does not retry pure interrupt races where the turn is already gone", () => {
  assert.isTrue(
    EffectWorker.isNonRetryableProviderTurnControlFailure(
      "provider-turn.interrupt",
      "ProviderAdapterInterruptError: ... ACP provider turn provider-turn:x is not active",
    ),
  );
  assert.isTrue(
    EffectWorker.isNonRetryableProviderTurnControlFailure(
      "provider-turn.interrupt",
      "Provider session provider-session:x is not active.",
    ),
  );
  // Restart is compound (interrupt + detach + start). Do not swallow start failures.
  assert.isFalse(
    EffectWorker.isNonRetryableProviderTurnControlFailure(
      "provider-turn.restart",
      "Provider session provider-session:x is not active.",
    ),
  );
  assert.isFalse(
    EffectWorker.isNonRetryableProviderTurnControlFailure(
      "provider-turn.start",
      "Provider session provider-session:x is not active.",
    ),
  );
  assert.isFalse(
    EffectWorker.isNonRetryableProviderTurnControlFailure(
      "provider-turn.interrupt",
      "ACP hard teardown failed unexpectedly; the session is poisoned",
    ),
  );
});

it.effect("requeues a claim when a pre-execution worker check fails", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-pre-execution-failure";
    const workerId = "worker-pre-execution-failure";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-pre-execution-failure"),
      threadId: ThreadId.make("thread:worker-pre-execution-failure"),
      request: { type: "terminal.cleanup" },
      status: "running",
      attemptCount: 1,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const retries = yield* Ref.make<
      ReadonlyArray<{
        readonly effectId: string;
        readonly workerId: string;
        readonly error: string;
        readonly delayMs: number;
      }>
    >([]);
    const executionCount = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      get: () =>
        Effect.fail(
          new EffectOutbox.EffectOutboxError({
            operation: "get",
            effectId,
            cause: "simulated cancellation-state read failure",
          }),
        ),
      retry: (input) =>
        Ref.update(retries, (existing) => [...existing, input]).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: () => Ref.update(executionCount, (count) => count + 1),
      }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.include(Cause.pretty(exit.cause), "simulated cancellation-state read failure");
    }
    assert.equal(yield* Ref.get(executionCount), 0);
    const retry = (yield* Ref.get(retries))[0];
    assert.isDefined(retry);
    assert.equal(retry.effectId, effectId);
    assert.equal(retry.workerId, workerId);
    assert.equal(retry.delayMs, 0);
    assert.include(retry.error, "simulated cancellation-state read failure");
  }),
);

it.effect("arms cancellation before the durable pre-execution check", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-cancellation-registration-race";
    const workerId = "worker-cancellation-registration-race";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-cancellation-registration-race"),
      threadId: ThreadId.make("thread:worker-cancellation-registration-race"),
      request: { type: "terminal.cleanup" },
      status: "running",
      attemptCount: 1,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const signal = yield* Deferred.make<void>();
    let cancellationArmed = false;
    const executionCount = yield* Ref.make(0);
    const settlementCount = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      awaitCancellation: () => {
        cancellationArmed = true;
        return Deferred.await(signal);
      },
      get: () =>
        Effect.gen(function* () {
          // Model a cancellation commit immediately after this durable read
          // took its snapshot. Its process-local signal is only delivered when
          // the worker registered the waiter before starting the read.
          if (cancellationArmed) {
            yield* Deferred.succeed(signal, undefined);
          }
          return Option.some(claimedEffect);
        }),
      clearCancellation: () => Effect.void,
      succeed: () => Ref.update(settlementCount, (count) => count + 1).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: () =>
          Effect.yieldNow.pipe(Effect.andThen(Ref.update(executionCount, (count) => count + 1))),
      }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    if (Exit.isFailure(exit)) {
      assert.fail(Cause.pretty(exit.cause));
    }
    assert.equal(yield* Ref.get(executionCount), 0);
    assert.equal(yield* Ref.get(settlementCount), 0);
  }),
);

it.effect("terminalizes a process-bound claim when success settlement fails", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-process-bound-settlement-failure";
    const workerId = "worker-process-bound-settlement-failure";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-process-bound-settlement-failure"),
      threadId: ThreadId.make("thread:worker-process-bound-settlement-failure"),
      request: {
        type: "provider-turn.start",
        runId: RunId.make("run:worker-process-bound-settlement-failure"),
      },
      status: "running",
      attemptCount: 1,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const retries = yield* Ref.make(0);
    const terminalErrors = yield* Ref.make<ReadonlyArray<string>>([]);
    const executionCount = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      get: () => Effect.succeed(Option.some(claimedEffect)),
      awaitCancellation: () => Effect.never,
      clearCancellation: () => Effect.void,
      succeed: () =>
        Effect.fail(
          new EffectOutbox.EffectOutboxError({
            operation: "succeed",
            effectId,
            cause: "simulated success settlement failure",
          }),
        ),
      retry: () => Ref.update(retries, (count) => count + 1).pipe(Effect.as(true)),
      fail: ({ error }) =>
        Ref.update(terminalErrors, (existing) => [...existing, error]).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: () => Ref.update(executionCount, (count) => count + 1),
      }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.equal(yield* Ref.get(executionCount), 1);
    assert.equal(yield* Ref.get(retries), 0);
    const terminalError = (yield* Ref.get(terminalErrors))[0];
    assert.isDefined(terminalError);
    assert.include(terminalError, "after execution started");
    assert.include(terminalError, "simulated success settlement failure");
  }),
);

it.effect("requeues a replay-safe claim when success settlement fails", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-replay-safe-settlement-failure";
    const workerId = "worker-replay-safe-settlement-failure";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-replay-safe-settlement-failure"),
      threadId: ThreadId.make("thread:worker-replay-safe-settlement-failure"),
      request: { type: "terminal.cleanup" },
      status: "running",
      attemptCount: 1,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const retries = yield* Ref.make(0);
    const terminalizations = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      get: () => Effect.succeed(Option.some(claimedEffect)),
      awaitCancellation: () => Effect.never,
      clearCancellation: () => Effect.void,
      succeed: () =>
        Effect.fail(
          new EffectOutbox.EffectOutboxError({
            operation: "succeed",
            effectId,
            cause: "simulated replay-safe settlement failure",
          }),
        ),
      retry: () => Ref.update(retries, (count) => count + 1).pipe(Effect.as(true)),
      fail: () => Ref.update(terminalizations, (count) => count + 1).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({ execute: () => Effect.void }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.equal(yield* Ref.get(retries), 1);
    assert.equal(yield* Ref.get(terminalizations), 0);
  }),
);

it.effect("keeps a process-bound executor failure retryable when retry settlement fails", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-process-bound-retry-settlement-failure";
    const workerId = "worker-process-bound-retry-settlement-failure";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-process-bound-retry-settlement-failure"),
      threadId: ThreadId.make("thread:worker-process-bound-retry-settlement-failure"),
      request: {
        type: "provider-turn.start",
        runId: RunId.make("run:worker-process-bound-retry-settlement-failure"),
      },
      status: "running",
      attemptCount: 1,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const retryAttempts = yield* Ref.make(0);
    const terminalizations = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      get: () => Effect.succeed(Option.some(claimedEffect)),
      awaitCancellation: () => Effect.never,
      clearCancellation: () => Effect.void,
      retry: () =>
        Ref.updateAndGet(retryAttempts, (count) => count + 1).pipe(
          Effect.flatMap((attempt) =>
            attempt === 1
              ? Effect.fail(
                  new EffectOutbox.EffectOutboxError({
                    operation: "retry",
                    effectId,
                    cause: "simulated retry settlement failure",
                  }),
                )
              : Effect.succeed(true),
          ),
        ),
      fail: () => Ref.update(terminalizations, (count) => count + 1).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: () =>
          Effect.fail(
            new EffectWorker.OrchestrationEffectExecutionError({
              effectId,
              effectType: claimedEffect.request.type,
              cause: "simulated provider execution failure",
            }),
          ),
      }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.equal(yield* Ref.get(retryAttempts), 2);
    assert.equal(yield* Ref.get(terminalizations), 0);
  }),
);

it.effect("keeps a max-attempt replay-safe failure terminal when fail settlement fails", () =>
  Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const effectId = "effect:worker-replay-safe-terminal-settlement-failure";
    const workerId = "worker-replay-safe-terminal-settlement-failure";
    const claimedEffect: EffectOutbox.OrchestrationEffectV2 = {
      id: effectId,
      commandId: CommandId.make("command:worker-replay-safe-terminal-settlement-failure"),
      threadId: ThreadId.make("thread:worker-replay-safe-terminal-settlement-failure"),
      request: { type: "terminal.cleanup" },
      status: "running",
      attemptCount: 5,
      availableAt: now,
      leaseOwner: workerId,
      leaseExpiresAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
    };
    const failAttempts = yield* Ref.make(0);
    const retries = yield* Ref.make(0);
    const outboxLayer = Layer.mock(EffectOutbox.EffectOutboxV2)({
      claimNext: () => Effect.succeed(Option.some(claimedEffect)),
      get: () => Effect.succeed(Option.some(claimedEffect)),
      awaitCancellation: () => Effect.never,
      clearCancellation: () => Effect.void,
      fail: () =>
        Ref.updateAndGet(failAttempts, (count) => count + 1).pipe(
          Effect.flatMap((attempt) =>
            attempt === 1
              ? Effect.fail(
                  new EffectOutbox.EffectOutboxError({
                    operation: "fail",
                    effectId,
                    cause: "simulated terminal settlement failure",
                  }),
                )
              : Effect.succeed(true),
          ),
        ),
      retry: () => Ref.update(retries, (count) => count + 1).pipe(Effect.as(true)),
    });
    const executorLayer = Layer.succeed(
      EffectWorker.OrchestrationEffectExecutorV2,
      EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: () =>
          Effect.fail(
            new EffectWorker.OrchestrationEffectExecutionError({
              effectId,
              effectType: claimedEffect.request.type,
              cause: "simulated terminal cleanup failure",
            }),
          ),
      }),
    );
    const workerLayer = EffectWorker.layerWithOptions({ workerId, maxAttempts: 5 }).pipe(
      Layer.provide(Layer.merge(outboxLayer, executorLayer)),
    );

    const exit = yield* EffectWorker.OrchestrationEffectWorkerV2.pipe(
      Effect.flatMap((worker) => worker.runOnce),
      Effect.provide(workerLayer),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.equal(yield* Ref.get(failAttempts), 2);
    assert.equal(yield* Ref.get(retries), 0);
  }),
);

it.effect("uses durable deadlines, notifications, and a slow liveness poll", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const attempted = yield* Queue.unbounded<void>();
    const available = yield* Queue.unbounded<void>();
    const now = yield* DateTime.now;
    const nextClaimableAt = yield* Ref.make<Option.Option<DateTime.Utc>>(
      Option.some(DateTime.add(now, { milliseconds: 100 })),
    );
    const worker = EffectWorker.OrchestrationEffectWorkerV2.of({
      awaitWork: Queue.take(available),
      runRecoveryOnce: Effect.succeed(false),
      runOnce: Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(attempts, (current) => current + 1);
        if (count === 2) {
          yield* Ref.set(nextClaimableAt, Option.some(DateTime.add(now, { milliseconds: 5_000 })));
        }
        if (count === 3) yield* Ref.set(nextClaimableAt, Option.none());
        yield* Queue.offer(attempted, undefined);
        return false;
      }),
      nextClaimableAt: Ref.get(nextClaimableAt),
      drain: () => Effect.succeed(0),
    });

    yield* EffectWorker.runDaemonWithOptions({
      concurrency: 1,
      livenessPollIntervalMs: 1_000,
    }).pipe(
      Effect.provideService(EffectWorker.OrchestrationEffectWorkerV2, worker),
      Effect.forkScoped,
    );

    yield* Queue.take(attempted);
    yield* TestClock.adjust("99 millis");
    assert.equal(yield* Ref.get(attempts), 1);

    yield* TestClock.adjust("1 millis");
    yield* Queue.take(attempted);
    yield* TestClock.adjust("999 millis");
    assert.equal(yield* Ref.get(attempts), 2);

    yield* Queue.offer(available, undefined);
    yield* Queue.take(attempted);
    yield* TestClock.adjust("999 millis");
    assert.equal(yield* Ref.get(attempts), 3);

    yield* TestClock.adjust("1 millis");
    yield* Queue.take(attempted);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("does not hot-loop when a claim fails", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const attempted = yield* Queue.unbounded<void>();
    const now = yield* DateTime.now;
    const worker = EffectWorker.OrchestrationEffectWorkerV2.of({
      awaitWork: Effect.never,
      runRecoveryOnce: Effect.succeed(false),
      runOnce: Ref.update(attempts, (count) => count + 1).pipe(
        Effect.andThen(Queue.offer(attempted, undefined)),
        Effect.andThen(
          new EffectWorker.OrchestrationEffectWorkerError({
            operation: "claim",
            cause: "simulated database failure",
          }),
        ),
      ),
      nextClaimableAt: Effect.succeed(Option.some(now)),
      drain: () => Effect.succeed(0),
    });

    yield* EffectWorker.runDaemonWithOptions({
      concurrency: 1,
      livenessPollIntervalMs: 1_000,
    }).pipe(
      Effect.provideService(EffectWorker.OrchestrationEffectWorkerV2, worker),
      Effect.forkScoped,
    );

    yield* Queue.take(attempted);
    yield* TestClock.adjust("999 millis");
    assert.equal(yield* Ref.get(attempts), 1);
    yield* TestClock.adjust("1 millis");
    yield* Queue.take(attempted);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("backs off briefly when a due deadline loses a claim race", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const attempted = yield* Queue.unbounded<void>();
    const now = yield* DateTime.now;
    const worker = EffectWorker.OrchestrationEffectWorkerV2.of({
      awaitWork: Effect.never,
      runRecoveryOnce: Effect.succeed(false),
      runOnce: Ref.update(attempts, (count) => count + 1).pipe(
        Effect.andThen(Queue.offer(attempted, undefined)),
        Effect.as(false),
      ),
      nextClaimableAt: Effect.succeed(Option.some(now)),
      drain: () => Effect.succeed(0),
    });

    yield* EffectWorker.runDaemonWithOptions({
      concurrency: 1,
      livenessPollIntervalMs: 1_000,
    }).pipe(
      Effect.provideService(EffectWorker.OrchestrationEffectWorkerV2, worker),
      Effect.forkScoped,
    );

    yield* Queue.take(attempted);
    yield* TestClock.adjust("24 millis");
    assert.equal(yield* Ref.get(attempts), 1);
    yield* TestClock.adjust("1 millis");
    yield* Queue.take(attempted);
  }).pipe(Effect.provide(TestClock.layer())),
);
