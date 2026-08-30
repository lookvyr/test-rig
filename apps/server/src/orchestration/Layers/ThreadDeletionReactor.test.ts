import { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";

import {
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "./ThreadDeletionReactor.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Manager.ts";

effectIt.effect(
  "expires persisted sides and finishes cleanup before subscribing to deletion events",
  () => {
    const calls: string[] = [];
    const sideId = ThreadId.make("stale-side");
    const dependencies = Layer.mergeAll(
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.sync(() => {
            calls.push(command.type);
            expect(command).toMatchObject({ type: "thread.delete", threadId: sideId });
            return { sequence: 1 };
          }),
        streamDomainEvents: Stream.never,
      }),
      Layer.mock(ProjectionThreadRepository)({ listSideThreadIds: () => Effect.succeed([sideId]) }),
      Layer.mock(ProviderService)({
        stopSession: ({ threadId }) =>
          Effect.sync(() => {
            expect(threadId).toBe(sideId);
            calls.push("provider-stopped");
          }),
      }),
      Layer.mock(TerminalManager)({
        close: ({ threadId, deleteHistory }) =>
          Effect.sync(() => {
            expect(threadId).toBe(sideId);
            expect(deleteHistory).toBe(true);
            calls.push("terminals-closed");
          }),
      }),
    );
    return Effect.gen(function* () {
      const reactor = yield* ThreadDeletionReactor;
      yield* reactor.start();
      expect(calls).toEqual(["thread.delete", "provider-stopped", "terminals-closed"]);
    }).pipe(
      Effect.provide(ThreadDeletionReactorLive.pipe(Layer.provide(dependencies))),
      Effect.scoped,
    );
  },
);

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});
