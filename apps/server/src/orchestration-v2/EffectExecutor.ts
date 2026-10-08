import { openSideChat } from "./SideChat.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";
import { CommandId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import { continueRestartedRun } from "./RestartContinuation.ts";

import * as RunFinalizationService from "./RunFinalizationService.ts";
import * as ResourceCleanupService from "./ResourceCleanupService.ts";
import * as CheckpointRollbackService from "./CheckpointRollbackService.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ProviderTurnControlService from "./ProviderTurnControlService.ts";
import * as ProviderTurnStartService from "./ProviderTurnStartService.ts";
import * as RuntimeRequestService from "./RuntimeRequestService.ts";
import * as ThreadTitleRegenerationService from "./ThreadTitleRegenerationService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

import {
  OrchestrationEffectExecutorV2,
  OrchestrationEffectExecutionError,
  isNonRetryableProviderTurnControlFailure,
} from "./EffectWorker.ts";
export const executorLayer: Layer.Layer<
  OrchestrationEffectExecutorV2,
  never,
  | ProviderSessionManager.ProviderSessionManagerV2
  | RunFinalizationService.RunFinalizationService
  | CheckpointRollbackService.CheckpointRollbackServiceV2
  | ProviderTurnControlService.ProviderTurnControlServiceV2
  | ProviderTurnStartService.ProviderTurnStartServiceV2
  | RuntimeRequestService.RuntimeRequestServiceV2
  | ThreadTitleRegenerationService.ThreadTitleRegenerationService
  | ThreadManagementService.ThreadManagementService
  | RuntimePolicyV2
  | ServerSettings.ServerSettingsService
> = Layer.effect(
  OrchestrationEffectExecutorV2,
  Effect.gen(function* () {
    const runFinalization = yield* RunFinalizationService.RunFinalizationService;
    const resourceCleanup = yield* ResourceCleanupService.ResourceCleanupService;
    const checkpointRollback = yield* CheckpointRollbackService.CheckpointRollbackServiceV2;
    const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const providerTurnControl = yield* ProviderTurnControlService.ProviderTurnControlServiceV2;
    const providerTurnStart = yield* ProviderTurnStartService.ProviderTurnStartServiceV2;
    const runtimeRequests = yield* RuntimeRequestService.RuntimeRequestServiceV2;
    const threadTitleRegeneration =
      yield* ThreadTitleRegenerationService.ThreadTitleRegenerationService;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const runtimePolicy = yield* RuntimePolicyV2;
    const settings = yield* ServerSettings.ServerSettingsService;
    return OrchestrationEffectExecutorV2.of({
      execute: (effect, options) => {
        const willRetry = options?.willRetry ?? false;
        switch (effect.request.type) {
          case "thread.side.open":
            return openSideChat({
              commandId: effect.commandId,
              parentThreadId: effect.request.parentThreadId,
              sideThreadId: effect.threadId,
            }).pipe(
              Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
              Effect.provideService(
                ProviderSessionManager.ProviderSessionManagerV2,
                providerSessions,
              ),
              Effect.provideService(RuntimePolicyV2, runtimePolicy),
              Effect.mapError(
                (cause) =>
                  new OrchestrationEffectExecutionError({
                    effectId: effect.id,
                    effectType: effect.request.type,
                    cause,
                  }),
              ),
            );
          case "provider-runtime.continue":
            return continueRestartedRun({
              threadId: effect.threadId,
              sourceRunId: effect.request.sourceRunId,
            }).pipe(
              Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
              Effect.provideService(ServerSettings.ServerSettingsService, settings),
              Effect.tapError(() =>
                willRetry
                  ? Effect.void
                  : effect.request.type === "provider-runtime.continue"
                    ? threads.recoverDelegatedTask(effect.threadId, effect.request.sourceRunId)
                    : Effect.void,
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationEffectExecutionError({
                    effectId: effect.id,
                    effectType: effect.request.type,
                    cause,
                  }),
              ),
            );
          case "provider-session.detach":
            return providerSessions
              .detach({
                providerSessionId: effect.request.providerSessionId,
                threadId: effect.threadId,
                ...(effect.request.detail === undefined ? {} : { detail: effect.request.detail }),
                ...(effect.request.revokeMcpCredential === undefined
                  ? {}
                  : { revokeMcpCredential: effect.request.revokeMcpCredential }),
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "provider-turn.start":
            return providerTurnStart
              .start({ threadId: effect.threadId, runId: effect.request.runId, willRetry })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "provider-turn.interrupt":
            return providerTurnControl
              .interrupt({
                threadId: effect.threadId,
                providerSessionId: effect.request.providerSessionId,
                providerThreadId: effect.request.providerThreadId,
                providerTurnId: effect.request.providerTurnId,
              })
              .pipe(
                Effect.catch((cause) =>
                  isNonRetryableProviderTurnControlFailure(
                    effect.request.type,
                    Cause.pretty(Cause.fail(cause)),
                  )
                    ? Effect.void
                    : Effect.fail(cause),
                ),
                // The provider has stopped what it still ran and reported it.
                // Whatever the thread still shows on that provider thread is
                // work no process will report on, so the Stop ends it too.
                Effect.andThen(
                  threads.dispatch({
                    type: "thread.background-work.settle",
                    commandId: CommandId.make(`${effect.commandId}:background-work-settled`),
                    threadId: effect.threadId,
                    providerThreadId: effect.request.providerThreadId,
                    providerTurnId: effect.request.providerTurnId,
                  }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "provider-turn.steer":
            return providerTurnControl
              .steer({
                threadId: effect.threadId,
                providerSessionId: effect.request.providerSessionId,
                providerThreadId: effect.request.providerThreadId,
                providerTurnId: effect.request.providerTurnId,
                messageId: effect.request.messageId,
              })
              .pipe(
                Effect.tap(() =>
                  Effect.gen(function* () {
                    if (effect.request.type !== "provider-turn.steer") return;
                    const messageId = effect.request.messageId;
                    const projection = yield* threads.getThreadRecords(
                      effect.threadId,
                      ["messages", "runs"],
                      { messageIds: [effect.request.messageId] },
                    );
                    const message = projection.messages.find((row) => row.id === messageId);
                    if (message?.delegatedCompletion === undefined) return;
                    yield* threads.dispatch({
                      type: "notification.delivery.accept",
                      commandId: CommandId.make(`command:mailbox-accepted:${effect.id}`),
                      threadId: effect.threadId,
                      messageId: message.id,
                    });
                  }),
                ),
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    if (
                      !("turnCompleted" in error) ||
                      !error.turnCompleted ||
                      effect.request.type !== "provider-turn.steer"
                    ) {
                      return yield* error;
                    }
                    const projection = yield* threads.getThreadRecords(
                      effect.threadId,
                      ["messages", "runs"],
                      { messageIds: [effect.request.messageId] },
                    );
                    const messageId = effect.request.messageId;
                    const message = projection.messages.find((item) => item.id === messageId);
                    const run = projection.runs.find((item) => item.id === message?.runId);
                    if (message === undefined || run === undefined) return yield* error;
                    // Reuse the message identity and a stable command receipt so an outbox
                    // retry cannot append a duplicate message or start a second follow-up.
                    yield* threads.dispatch({
                      type: "message.dispatch",
                      commandId: CommandId.make(`command:steer-follow-up:${effect.id}`),
                      threadId: effect.threadId,
                      messageId: message.id,
                      text: message.text,
                      ...(message.context ? { context: message.context } : {}),
                      attachments: message.attachments,
                      ...(message.delegatedCompletion === undefined
                        ? {}
                        : { modelSelection: run.modelSelection }),
                      dispatchMode: {
                        type:
                          message.delegatedCompletion === undefined
                            ? "start_immediately"
                            : "queue_after_active",
                      },
                      createdBy: message.createdBy,
                      creationSource: message.creationSource,
                      ...(message.delegatedCompletion === undefined
                        ? {}
                        : { delegatedCompletion: message.delegatedCompletion }),
                      ...(message.notification === undefined
                        ? {}
                        : { notification: message.notification }),
                      ...(message.scheduledTaskId === undefined
                        ? {}
                        : { scheduledTaskId: message.scheduledTaskId }),
                      ...(message.senderThreadId === undefined
                        ? {}
                        : { senderThreadId: message.senderThreadId }),
                    });
                  }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "provider-turn.restart":
            return providerTurnControl
              .interruptAndAwaitTerminal({
                threadId: effect.threadId,
                providerSessionId: effect.request.providerSessionId,
                providerThreadId: effect.request.providerThreadId,
                providerTurnId: effect.request.providerTurnId,
                interruptedAttemptId: effect.request.interruptedAttemptId,
                ...(effect.request.sessionTransition?.type === "replace"
                  ? {
                      replacementProviderSessionId:
                        effect.request.sessionTransition.replacementProviderSessionId,
                    }
                  : {}),
              })
              .pipe(
                Effect.andThen(
                  effect.request.sessionTransition?.type === "replace"
                    ? providerSessions.detach({
                        providerSessionId: effect.request.providerSessionId,
                        threadId: effect.threadId,
                        detail: "Selection change requires a provider session restart.",
                      })
                    : effect.request.sessionTransition?.type === "detach"
                      ? providerSessions.detach({
                          providerSessionId: effect.request.providerSessionId,
                          threadId: effect.threadId,
                          detail: "Provider thread handoff replaced this session binding.",
                        })
                      : Effect.void,
                ),
                Effect.andThen(
                  providerTurnStart.start({
                    threadId: effect.threadId,
                    runId: effect.request.runId,
                    willRetry,
                  }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "runtime-request.respond":
            return runtimeRequests
              .respond({
                threadId: effect.threadId,
                providerSessionId: effect.request.providerSessionId,
                requestId: effect.request.requestId,
                ...(effect.request.decision === undefined
                  ? {}
                  : { decision: effect.request.decision }),
                ...(effect.request.answers === undefined
                  ? {}
                  : { answers: effect.request.answers }),
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "provider-thread.rollback":
            return checkpointRollback
              .execute({
                threadId: effect.threadId,
                providerThreadId: effect.request.providerThreadId,
                checkpointId: effect.request.checkpointId,
                scopeId: effect.request.scopeId,
                ...(effect.request.restoreFiles === undefined
                  ? {}
                  : { restoreFiles: effect.request.restoreFiles }),
              })
              .pipe(
                // The last failed attempt tells waiting clients it failed,
                // instead of leaving them to time out. Clients get a fixed
                // message; the worker logs the full cause for each attempt.
                Effect.tapCause((cause) =>
                  willRetry || Cause.hasInterruptsOnly(cause)
                    ? Effect.void
                    : threads
                        .dispatch({
                          type: "checkpoint.rollback.fail",
                          commandId: CommandId.make(`${effect.commandId}:rollback-failed`),
                          threadId: effect.threadId,
                          requestId: effect.commandId,
                          message: CheckpointRollbackService.ROLLBACK_FAILED_MESSAGE,
                        })
                        .pipe(
                          Effect.catchCause((recordCause) =>
                            Effect.logWarning("Failed to record rollback failure", {
                              effectId: effect.id,
                              cause: recordCause,
                            }),
                          ),
                        ),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "checkpoint.capture":
            return runFinalization
              .finalize({
                threadId: effect.threadId,
                runId: effect.request.runId,
                scopeId: effect.request.scopeId,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "terminal.cleanup":
            return resourceCleanup.cleanupTerminals(effect.threadId).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationEffectExecutionError({
                    effectId: effect.id,
                    effectType: effect.request.type,
                    cause,
                  }),
              ),
            );
          case "attachment.cleanup":
            return resourceCleanup.cleanupAttachments(effect.request.attachmentIds).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationEffectExecutionError({
                    effectId: effect.id,
                    effectType: effect.request.type,
                    cause,
                  }),
              ),
            );
          case "delegated-tasks.stop":
            return threads
              .stopDelegatedTasks({
                threadId: effect.threadId,
                commandId: effect.commandId,
                reason: effect.request.reason,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
          case "thread-title.generate":
            return threadTitleRegeneration
              .execute({
                threadId: effect.threadId,
                requestId: effect.commandId,
                kind: effect.request.kind,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationEffectExecutionError({
                      effectId: effect.id,
                      effectType: effect.request.type,
                      cause,
                    }),
                ),
              );
        }
      },
    });
  }),
);
