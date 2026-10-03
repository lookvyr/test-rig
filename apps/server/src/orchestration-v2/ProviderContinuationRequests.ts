import type { ProviderDriverKind, ProviderThreadId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";

export interface ProviderContinuationRequest {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly driver: ProviderDriverKind;
  readonly nativeTurnId: TurnId;
}

/** The V2 dispatch worker consumes these offers before queued user messages. */
export class ProviderContinuationRequests extends Context.Service<
  ProviderContinuationRequests,
  {
    readonly offer: (request: ProviderContinuationRequest) => Effect.Effect<void>;
    readonly take: Effect.Effect<ProviderContinuationRequest>;
  }
>()("t3/orchestration-v2/ProviderContinuationRequests") {}

export const layer = Layer.effect(
  ProviderContinuationRequests,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ProviderContinuationRequest>();
    return {
      offer: (request: ProviderContinuationRequest) =>
        Queue.offer(queue, request).pipe(Effect.asVoid),
      take: Queue.take(queue),
    };
  }),
);
