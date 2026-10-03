import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as EffectOutbox from "./EffectOutbox.ts";

export class OrchestrationEffectExecutionError extends Schema.TaggedErrorClass<OrchestrationEffectExecutionError>()(
  "OrchestrationEffectExecutionError",
  {
    effectId: Schema.String,
    effectType: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Pure interrupt races with hard process teardown or a dead session produce
 * "not active" protocol errors. Retrying those only delays recovery.
 *
 * Do not apply this to `provider-turn.restart`: that compound effect also runs
 * detach and start. Swallowing a start failure that happens to mention
 * "is not active" would drop the outbox item without ever starting the
 * replacement turn.
 */
export function isNonRetryableProviderTurnControlFailure(
  effectType: string,
  errorText: string,
): boolean {
  if (effectType !== "provider-turn.interrupt") {
    return false;
  }
  return (
    /is not active/i.test(errorText) ||
    /hard teardown is already in progress/i.test(errorText) ||
    /treating as already interrupted/i.test(errorText) ||
    /treating as already stopped/i.test(errorText)
  );
}

export interface OrchestrationEffectExecutorV2Shape {
  /**
   * Runs one claimed effect. `willRetry` is true when the worker will retry a
   * failure, so a step can fail and try again instead of settling the run.
   */
  readonly execute: (
    effect: EffectOutbox.OrchestrationEffectV2,
    options?: { readonly willRetry: boolean },
  ) => Effect.Effect<void, OrchestrationEffectExecutionError>;
}

export class OrchestrationEffectExecutorV2 extends Context.Service<
  OrchestrationEffectExecutorV2,
  OrchestrationEffectExecutorV2Shape
>()("t3/orchestration-v2/EffectWorker/OrchestrationEffectExecutorV2") {}

export class OrchestrationEffectWorkerError extends Schema.TaggedErrorClass<OrchestrationEffectWorkerError>()(
  "OrchestrationEffectWorkerError",
  {
    operation: Schema.String,
    effectId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const isOrchestrationEffectWorkerError = Schema.is(OrchestrationEffectWorkerError);

export interface OrchestrationEffectWorkerV2Shape {
  readonly awaitWork: Effect.Effect<void>;
  readonly runOnce: Effect.Effect<boolean, OrchestrationEffectWorkerError>;
  readonly runRecoveryOnce: Effect.Effect<boolean, OrchestrationEffectWorkerError>;
  readonly nextClaimableAt: Effect.Effect<
    Option.Option<DateTime.Utc>,
    OrchestrationEffectWorkerError
  >;
  readonly drain: (maxEffects?: number) => Effect.Effect<number, OrchestrationEffectWorkerError>;
}

export class OrchestrationEffectWorkerV2 extends Context.Service<
  OrchestrationEffectWorkerV2,
  OrchestrationEffectWorkerV2Shape
>()("t3/orchestration-v2/EffectWorker/OrchestrationEffectWorkerV2") {}

export interface OrchestrationEffectWorkerOptions {
  readonly workerId?: string;
  readonly leaseDurationMs?: number;
  readonly maxAttempts?: number;
}

export const layerWithOptions = (
  options: OrchestrationEffectWorkerOptions = {},
): Layer.Layer<
  OrchestrationEffectWorkerV2,
  never,
  EffectOutbox.EffectOutboxV2 | OrchestrationEffectExecutorV2
> =>
  Layer.effect(
    OrchestrationEffectWorkerV2,
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const executor = yield* OrchestrationEffectExecutorV2;
      const workerId = options.workerId ?? `orchestration-v2:${process.pid}`;
      const leaseDurationMs = Math.max(1, options.leaseDurationMs ?? 30_000);
      const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
      const wasCancelled = (effectId: string) =>
        outbox.get(effectId).pipe(
          Effect.map(
            Option.match({
              onNone: () => false,
              onSome: (effect) => effect.status === "cancelled",
            }),
          ),
        );
      const requeueClaim = (
        effect: EffectOutbox.OrchestrationEffectV2,
        cause: Cause.Cause<unknown>,
      ) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : outbox
              .retry({
                effectId: effect.id,
                workerId,
                error: `Worker failed before settling the claimed effect: ${Cause.pretty(cause)}`,
                delayMs: 0,
              })
              .pipe(
                Effect.flatMap((requeued) =>
                  requeued
                    ? Effect.logWarning("Requeued effect after unexpected worker failure", {
                        effectId: effect.id,
                        effectType: effect.request.type,
                      })
                    : Effect.logWarning("Could not requeue effect after worker lost its lease", {
                        effectId: effect.id,
                        effectType: effect.request.type,
                      }),
                ),
                Effect.catchCause((requeueCause) =>
                  Effect.logError("Failed to requeue effect after unexpected worker failure", {
                    effectId: effect.id,
                    effectType: effect.request.type,
                    error: Cause.pretty(requeueCause),
                  }),
                ),
              );
      const terminalizeClaim = (
        effect: EffectOutbox.OrchestrationEffectV2,
        cause: Cause.Cause<unknown>,
      ) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void;
        return outbox
          .fail({
            effectId: effect.id,
            workerId,
            error: `Worker failed to settle a process-bound effect after execution started: ${Cause.pretty(cause)}`,
          })
          .pipe(
            Effect.flatMap((failed) =>
              failed
                ? Effect.logError("Terminalized process-bound effect after settlement failure", {
                    effectId: effect.id,
                    effectType: effect.request.type,
                  })
                : Effect.logWarning(
                    "Could not terminalize process-bound effect after worker lost its lease",
                    {
                      effectId: effect.id,
                      effectType: effect.request.type,
                    },
                  ),
            ),
            Effect.catchCause((failCause) =>
              Effect.logError(
                "Failed to terminalize process-bound effect after settlement failure",
                {
                  effectId: effect.id,
                  effectType: effect.request.type,
                  error: Cause.pretty(failCause),
                },
              ),
            ),
          );
      };
      const recoverPostSuccessSettlement = (
        effect: EffectOutbox.OrchestrationEffectV2,
        cause: Cause.Cause<unknown>,
      ) =>
        EffectOutbox.REPLAY_SAFE_EFFECT_TYPES_AFTER_PROCESS_LOSS.some(
          (effectType) => effectType === effect.request.type,
        )
          ? requeueClaim(effect, cause)
          : terminalizeClaim(effect, cause);

      const runOnce = (excludeRestartContinuations = false) =>
        Effect.gen(function* () {
          const claimExit = yield* Effect.exit(
            outbox.claimNext({ workerId, leaseDurationMs, excludeRestartContinuations }),
          );
          if (Exit.isFailure(claimExit)) return yield* Effect.failCause(claimExit.cause);
          const claimed = claimExit.value;
          if (Option.isNone(claimed)) {
            return false;
          }
          const effect = claimed.value;
          // Arm the process-local cancellation signal before re-reading durable
          // state. A cancellation that commits after the row read has begun can
          // then still win the execution race instead of falling into the gap
          // between the read and signal registration.
          const cancellation = outbox
            .awaitCancellation(effect.id)
            .pipe(Effect.as("cancelled" as const));
          const cancelledBeforeExecution = yield* Effect.gen(function* () {
            // Cancellation can commit after the durable claim but before the
            // process-local Deferred is registered. Re-read the authoritative row
            // once before starting external work; later cancellations use the
            // Deferred raced below.
            if (yield* wasCancelled(effect.id)) {
              yield* outbox.clearCancellation(effect.id);
              return true;
            }
            return false;
          }).pipe(Effect.onError((cause) => requeueClaim(effect, cause)));
          if (cancelledBeforeExecution) return true;

          const execution = executor
            .execute(effect, { willRetry: effect.attemptCount < maxAttempts })
            .pipe(Effect.as("executed" as const));
          const exit = yield* Effect.exit(Effect.raceFirst(execution, cancellation)).pipe(
            Effect.ensuring(outbox.clearCancellation(effect.id)),
          );
          if (Exit.isSuccess(exit) && exit.value === "cancelled") {
            return true;
          }
          if (Exit.isSuccess(exit)) {
            return yield* Effect.gen(function* () {
              const completed = yield* outbox.succeed({ effectId: effect.id, workerId });
              if (!completed) {
                if (yield* wasCancelled(effect.id)) return true;
                return yield* new OrchestrationEffectWorkerError({
                  operation: "complete",
                  effectId: effect.id,
                  cause: "The worker no longer owns the effect lease.",
                });
              }
              return true;
            }).pipe(Effect.onError((cause) => recoverPostSuccessSettlement(effect, cause)));
          }

          const error = Cause.pretty(exit.cause);
          const nonRetryable = isNonRetryableProviderTurnControlFailure(effect.request.type, error);
          yield* Effect.logWarning("Orchestration effect execution failed", {
            effectId: effect.id,
            effectType: effect.request.type,
            attemptCount: effect.attemptCount,
            nonRetryable,
            error,
          });
          // Prefer succeed for terminal interrupt races so the outbox does not
          // keep a failed interrupt around; fail only when we must not retry.
          const updated = nonRetryable
            ? yield* outbox
                .succeed({ effectId: effect.id, workerId })
                .pipe(Effect.onError((cause) => terminalizeClaim(effect, cause)))
            : effect.attemptCount >= maxAttempts
              ? yield* outbox
                  .fail({ effectId: effect.id, workerId, error })
                  .pipe(Effect.onError((cause) => terminalizeClaim(effect, cause)))
              : yield* outbox
                  .retry({
                    effectId: effect.id,
                    workerId,
                    error,
                    delayMs: Math.min(30_000, 100 * 2 ** Math.max(0, effect.attemptCount - 1)),
                  })
                  .pipe(Effect.onError((cause) => requeueClaim(effect, cause)));
          if (!updated) {
            if (yield* wasCancelled(effect.id)) return true;
            return yield* new OrchestrationEffectWorkerError({
              operation: "reschedule",
              effectId: effect.id,
              cause: "The worker no longer owns the effect lease.",
            });
          }
          return true;
        }).pipe(
          Effect.mapError((cause) =>
            isOrchestrationEffectWorkerError(cause)
              ? cause
              : new OrchestrationEffectWorkerError({ operation: "run", cause }),
          ),
        );

      return OrchestrationEffectWorkerV2.of({
        awaitWork: outbox.awaitAvailable,
        runOnce: runOnce(),
        runRecoveryOnce: runOnce(true),
        nextClaimableAt: outbox.nextClaimableAt.pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationEffectWorkerError({
                operation: "next-claimable",
                cause,
              }),
          ),
        ),
        drain: (maxEffects = Number.MAX_SAFE_INTEGER) =>
          Effect.gen(function* () {
            let completed = 0;
            while (completed < maxEffects && (yield* runOnce())) {
              completed += 1;
            }
            return completed;
          }),
      });
    }),
  );

export const layer = layerWithOptions();

export interface OrchestrationEffectDaemonOptions {
  readonly concurrency?: number;
  readonly livenessPollIntervalMs?: number;
}

const DEFAULT_EFFECT_WORKER_CONCURRENCY = 4;
const DEFAULT_EFFECT_WORKER_LIVENESS_POLL_INTERVAL_MS = 30_000;

export const runDaemonWithOptions = (options: OrchestrationEffectDaemonOptions = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const worker = yield* OrchestrationEffectWorkerV2;
      const requestedConcurrency = options.concurrency ?? DEFAULT_EFFECT_WORKER_CONCURRENCY;
      const concurrency = Number.isFinite(requestedConcurrency)
        ? Math.max(1, Math.floor(requestedConcurrency))
        : DEFAULT_EFFECT_WORKER_CONCURRENCY;
      const requestedLivenessPollIntervalMs =
        options.livenessPollIntervalMs ?? DEFAULT_EFFECT_WORKER_LIVENESS_POLL_INTERVAL_MS;
      const livenessPollIntervalMs = Number.isFinite(requestedLivenessPollIntervalMs)
        ? Math.max(1, Math.floor(requestedLivenessPollIntervalMs))
        : DEFAULT_EFFECT_WORKER_LIVENESS_POLL_INTERVAL_MS;
      // Post-commit notifications are the low-latency path. `availableAt` is the
      // durable retry schedule, and the long liveness poll only recovers from a
      // missed in-process notification or work inserted by another process.
      const runWorker = Effect.gen(function* () {
        while (true) {
          const outcome = yield* worker.runOnce.pipe(
            Effect.map((worked) => (worked ? ("worked" as const) : ("idle" as const))),
            Effect.catchCause((cause) =>
              Effect.logWarning("Orchestration effect worker failed", cause).pipe(
                Effect.as("failed" as const),
              ),
            ),
          );
          if (outcome === "worked") {
            yield* Effect.yieldNow;
            continue;
          }
          if (outcome === "failed") {
            // A due row can remain visible when a claim UPDATE fails. Do not
            // feed that past deadline back into the scheduler and retry at the
            // one-millisecond floor; let transient database failures cool off.
            yield* Effect.sleep(Duration.millis(Math.min(1_000, livenessPollIntervalMs)));
            continue;
          }

          const nextClaimableAt = yield* worker.nextClaimableAt.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                "Failed to read the next orchestration effect deadline",
                cause,
              ).pipe(Effect.as(Option.none<DateTime.Utc>())),
            ),
          );
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const sleepMs = Option.match(nextClaimableAt, {
            onNone: () => livenessPollIntervalMs,
            onSome: (availableAt) => {
              const untilAvailable = DateTime.toEpochMillis(availableAt) - now;
              return Math.min(livenessPollIntervalMs, untilAvailable > 0 ? untilAvailable : 25);
            },
          });
          yield* Effect.raceFirst(
            worker.awaitWork.pipe(Effect.as("notified" as const)),
            Effect.sleep(Duration.millis(sleepMs)).pipe(Effect.as("scheduled" as const)),
          );
        }
      });

      return yield* Effect.all(
        Array.from({ length: concurrency }, () => runWorker),
        {
          concurrency: "unbounded",
          discard: true,
        },
      );
    }),
  );

export const runDaemon = runDaemonWithOptions();

export const daemonLayer: Layer.Layer<never, never, OrchestrationEffectWorkerV2> =
  Layer.effectDiscard(runDaemon.pipe(Effect.forkScoped));
