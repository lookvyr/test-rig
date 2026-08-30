import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-08-30T12:00:00.000Z";
const parentId = ThreadId.make("parent");
const sideId = ThreadId.make("side");
const projectId = ProjectId.make("project");
const commandId = CommandId.make("side-command");
const parent: OrchestrationThread = {
  id: parentId,
  projectId,
  title: "Parent task",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: "plan",
  branch: "codex/example",
  worktreePath: "/tmp/example/worktree",
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId: parentId,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: "full-access",
    status: "running",
    activeTurnId: null,
    lastError: null,
    updatedAt: now,
  },
};

const side: OrchestrationThread = {
  ...parent,
  id: sideId,
  sideOfThreadId: parentId,
  title: "Side chat",
  session: { ...parent.session!, threadId: sideId, status: "ready" },
};

const model = (threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads,
  updatedAt: now,
});

const open: OrchestrationCommand = {
  type: "thread.side.open",
  commandId,
  threadId: parentId,
  sideThreadId: sideId,
  createdAt: now,
};

const decide = (command: OrchestrationCommand, threads = [parent]) =>
  decideOrchestrationCommand({ command, readModel: model(threads) });

const events = (
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
) => (Array.isArray(result) ? result : [result]);

it.layer(NodeServices.layer)("side chat lifecycle decisions", (it) => {
  it.effect("creates an empty child with inherited settings and the shared checkout", () =>
    Effect.gen(function* () {
      const [event] = events(yield* decide(open));
      assert.strictEqual(event?.type, "thread.created");
      const result = yield* projectEvent(model([parent]), { ...event!, sequence: 1 });
      const child = result.threads.find((thread) => thread.id === sideId)!;
      assert.strictEqual(child.sideOfThreadId, parentId);
      assert.deepStrictEqual(child.modelSelection, parent.modelSelection);
      assert.strictEqual(child.runtimeMode, parent.runtimeMode);
      assert.strictEqual(child.interactionMode, parent.interactionMode);
      assert.strictEqual(child.worktreePath, parent.worktreePath);
      assert.strictEqual(child.branch, parent.branch);
      assert.deepStrictEqual(child.messages, []);
      assert.strictEqual(child.session, null);
    }),
  );

  it.effect("reopening an existing side emits no second create", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide(open, [parent, side]), []);
    }),
  );

  it.effect("rejects deleted, archived, nested, and unstarted or unsupported parents", () =>
    Effect.gen(function* () {
      for (const candidate of [
        { ...parent, deletedAt: now },
        { ...parent, archivedAt: now },
        { ...parent, sideOfThreadId: ThreadId.make("ancestor") },
        { ...parent, session: null },
        { ...parent, session: { ...parent.session!, providerName: "claudeAgent" as const } },
      ]) {
        const result = yield* Effect.result(decide(open, [candidate]));
        assert.strictEqual(result._tag, "Failure");
      }
    }),
  );

  it.effect("keeping changes only the relationship and rejects a stale discard", () =>
    Effect.gen(function* () {
      const runningSide = { ...side, session: { ...side.session!, status: "running" as const } };
      const [event] = events(
        yield* decide({ type: "thread.side.keep", commandId, threadId: sideId }, [
          parent,
          runningSide,
        ]),
      );
      const after = yield* projectEvent(model([parent, runningSide]), { ...event!, sequence: 1 });
      const kept = after.threads.find((thread) => thread.id === sideId)!;
      assert.strictEqual(kept.sideOfThreadId, null);
      assert.deepStrictEqual(kept.session, runningSide.session);
      assert.deepStrictEqual(kept.messages, runningSide.messages);
      assert.strictEqual(kept.worktreePath, side.worktreePath);
      const staleDiscard = yield* Effect.result(
        decide(
          {
            type: "thread.delete",
            commandId,
            threadId: sideId,
            onlyIfSideOfThreadId: parentId,
          },
          [parent, kept],
        ),
      );
      assert.strictEqual(staleDiscard._tag, "Failure");
    }),
  );

  it.effect("rejects keeping a discarded or incompletely opened side", () =>
    Effect.gen(function* () {
      for (const candidate of [
        { ...side, deletedAt: now },
        { ...side, sideOfThreadId: null },
        { ...side, session: null },
        { ...side, session: { ...side.session!, status: "starting" as const } },
        { ...side, session: { ...side.session!, status: "error" as const } },
      ]) {
        const result = yield* Effect.result(
          decide({ type: "thread.side.keep", commandId, threadId: sideId }, [parent, candidate]),
        );
        assert.strictEqual(result._tag, "Failure");
      }
    }),
  );

  it.effect("parent deletion cascades only to temporary sides", () =>
    Effect.gen(function* () {
      const kept = { ...side, id: ThreadId.make("kept"), sideOfThreadId: null };
      const deleted = events(
        yield* decide({ type: "thread.delete", commandId, threadId: parentId }, [
          parent,
          side,
          kept,
        ]),
      );
      assert.deepStrictEqual(
        deleted.map((event) => event.aggregateId),
        [sideId, parentId],
      );
      const discarded = events(
        yield* decide(
          { type: "thread.delete", commandId, threadId: sideId, onlyIfSideOfThreadId: parentId },
          [parent, side],
        ),
      );
      assert.deepStrictEqual(
        discarded.map((event) => event.aggregateId),
        [sideId],
      );
    }),
  );

  it.effect("blocks side restores and parent restores until the side is kept or discarded", () =>
    Effect.gen(function* () {
      for (const threadId of [parentId, sideId]) {
        const result = yield* Effect.result(
          decide(
            { type: "thread.checkpoint.revert", commandId, threadId, turnCount: 0, createdAt: now },
            [parent, side],
          ),
        );
        assert.strictEqual(result._tag, "Failure");
      }
      const allowed = events(
        yield* decide(
          {
            type: "thread.checkpoint.revert",
            commandId,
            threadId: parentId,
            turnCount: 0,
            createdAt: now,
          },
          [parent, { ...side, deletedAt: now }],
        ),
      );
      assert.strictEqual(allowed[0]?.type, "thread.checkpoint-revert-requested");
    }),
  );
});
