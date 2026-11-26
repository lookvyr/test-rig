import { assert, it, vi } from "@effect/vitest";
import { CheckpointRef, CheckpointScopeId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import { OrchestratorProjectionError } from "../orchestration-v2/Orchestrator.ts";
import type { ProjectionCheckpointContext } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as CheckpointDiffQuery from "./CheckpointDiffQuery.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import {
  CheckpointRefUnavailableError,
  CheckpointThreadNotFoundError,
  CheckpointTurnRangeUnavailableError,
} from "./Errors.ts";

const threadId = ThreadId.make("thread:checkpoint-diff-v2");
const firstRunId = RunId.make("run:checkpoint-diff-v2:1");
const secondRunId = RunId.make("run:checkpoint-diff-v2:2");
const firstScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:1");
const secondScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:2");
const secondRef = CheckpointRef.make("refs/t3/test/second");

function makeProjection(): ProjectionCheckpointContext {
  return {
    runs: [
      { id: firstRunId, ordinal: 1, status: "completed" },
      { id: secondRunId, ordinal: 2, status: "completed" },
    ],
    checkpointScopes: [
      { id: firstScopeId, runId: firstRunId, kind: "root_run", cwd: "/repo" },
      { id: secondScopeId, runId: secondRunId, kind: "root_run", cwd: "/repo" },
    ],
    checkpoints: [
      {
        scopeId: secondScopeId,
        runId: secondRunId,
        appRunOrdinal: 2,
        ordinalWithinScope: 2,
        status: "ready",
        ref: secondRef,
      },
    ],
  };
}

function makeLayer(input: {
  readonly projection: Effect.Effect<ProjectionCheckpointContext, OrchestratorProjectionError>;
  readonly diffCheckpoints?: CheckpointStore.CheckpointStore["Service"]["diffCheckpoints"];
}) {
  return CheckpointDiffQuery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getCheckpointContext: () => input.projection,
        }),
        Layer.mock(CheckpointStore.CheckpointStore)({
          diffCheckpoints: input.diffCheckpoints ?? (() => Effect.succeed("diff")),
        }),
      ),
    ),
  );
}

it.effect("computes V2 run diffs from projected checkpoint scopes", () => {
  const diffCheckpoints = vi.fn((_input: CheckpointStore.DiffCheckpointsInput) =>
    Effect.succeed("diff --git a/file b/file"),
  );
  const layer = makeLayer({ projection: Effect.succeed(makeProjection()), diffCheckpoints });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const result = yield* query.getFullThreadDiff({ threadId, toTurnCount: 2 });

    assert.deepEqual(result, {
      threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
      diff: "diff --git a/file b/file",
    });
    assert.deepEqual(diffCheckpoints.mock.calls[0]?.[0], {
      cwd: "/repo",
      fromCheckpointRef: checkpointRefForScopeOrdinal({
        scopeId: firstScopeId,
        ordinalWithinScope: 0,
      }),
      toCheckpointRef: secondRef,
      fallbackFromToHead: false,
      ignoreWhitespace: true,
    });
  }).pipe(Effect.provide(layer));
});

it.effect("preserves the typed missing-thread error contract", () => {
  const layer = makeLayer({
    projection: Effect.fail(new OrchestratorProjectionError({ threadId })),
  });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const error = yield* query
      .getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 1 })
      .pipe(Effect.flip);

    assert.instanceOf(error, CheckpointThreadNotFoundError);
    assert.deepEqual(
      { operation: error.operation, threadId: error.threadId },
      { operation: "CheckpointDiffQuery.getTurnDiff", threadId },
    );
  }).pipe(Effect.provide(layer));
});

it.effect("preserves the typed unavailable-range error contract", () => {
  const layer = makeLayer({ projection: Effect.succeed(makeProjection()) });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const error = yield* query
      .getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 3 })
      .pipe(Effect.flip);

    assert.instanceOf(error, CheckpointTurnRangeUnavailableError);
    assert.deepEqual(
      {
        requestedTurnCount: error.requestedTurnCount,
        availableTurnCount: error.availableTurnCount,
      },
      { requestedTurnCount: 3, availableTurnCount: 2 },
    );
  }).pipe(Effect.provide(layer));
});

it.effect("excludes ready checkpoints from rolled-back runs", () => {
  const projection = makeProjection();
  const layer = makeLayer({
    projection: Effect.succeed({
      ...projection,
      runs: projection.runs.map((run) =>
        run.id === secondRunId ? { ...run, status: "rolled_back" as const } : run,
      ),
      checkpoints: [
        {
          ...projection.checkpoints[0]!,
          scopeId: firstScopeId,
          runId: firstRunId,
          appRunOrdinal: 1,
          ref: CheckpointRef.make("refs/t3/test/first"),
        },
        ...projection.checkpoints,
      ],
    }),
  });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const error = yield* query
      .getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 2 })
      .pipe(Effect.flip);

    assert.instanceOf(error, CheckpointTurnRangeUnavailableError);
    assert.deepEqual(
      {
        requestedTurnCount: error.requestedTurnCount,
        availableTurnCount: error.availableTurnCount,
      },
      { requestedTurnCount: 2, availableTurnCount: 1 },
    );
  }).pipe(Effect.provide(layer));
});

it.effect("preserves the typed missing-baseline-ref error contract", () => {
  const projection = makeProjection();
  const layer = makeLayer({
    projection: Effect.succeed({
      ...projection,
      checkpointScopes: projection.checkpointScopes.map((scope) => ({
        ...scope,
        kind: "tool" as const,
      })),
    }),
  });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const error = yield* query
      .getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 2 })
      .pipe(Effect.flip);

    assert.instanceOf(error, CheckpointRefUnavailableError);
    assert.deepEqual(
      { checkpoint: error.checkpoint, turnCount: error.turnCount },
      { checkpoint: "from", turnCount: 0 },
    );
  }).pipe(Effect.provide(layer));
});

it.effect("preserves the explicit whitespace choice without preflighting refs", () => {
  const diffCheckpoints = vi.fn((_input: CheckpointStore.DiffCheckpointsInput) =>
    Effect.succeed("diff"),
  );
  // The mock deliberately supplies no hasCheckpointRef implementation.
  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    yield* query.getFullThreadDiff({ threadId, toTurnCount: 2, ignoreWhitespace: false });
    assert.strictEqual(diffCheckpoints.mock.calls[0]?.[0].ignoreWhitespace, false);
  }).pipe(
    Effect.provide(makeLayer({ projection: Effect.succeed(makeProjection()), diffCheckpoints })),
  );
});

it.effect("joins a plain folder's repositories into one patch, each under its folder", () => {
  const apiScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:api");
  const webScopeId = CheckpointScopeId.make("scope:checkpoint-diff-v2:web");
  const ref = (name: string) => CheckpointRef.make(`refs/t3/test/${name}`);
  const projection: ProjectionCheckpointContext = {
    runs: [
      { id: firstRunId, ordinal: 1, status: "completed" },
      { id: secondRunId, ordinal: 2, status: "completed" },
    ],
    checkpointScopes: [
      { id: firstScopeId, runId: firstRunId, kind: "root_run", cwd: "/shop" },
      {
        id: apiScopeId,
        runId: firstRunId,
        kind: "repository",
        cwd: "/shop/api",
        label: "api",
        relativePath: "api",
      },
      {
        id: webScopeId,
        runId: secondRunId,
        kind: "repository",
        cwd: "/shop/web",
        label: "web",
        relativePath: "web",
      },
    ],
    checkpoints: [
      // The plain folder itself has no snapshots.
      {
        scopeId: firstScopeId,
        runId: firstRunId,
        appRunOrdinal: 1,
        ordinalWithinScope: 1,
        status: "missing",
        ref: ref("root-1"),
      },
      {
        scopeId: firstScopeId,
        runId: secondRunId,
        appRunOrdinal: 2,
        ordinalWithinScope: 2,
        status: "missing",
        ref: ref("root-2"),
      },
      // api changed in turn 1, web in turn 2.
      {
        scopeId: apiScopeId,
        runId: null,
        appRunOrdinal: null,
        ordinalWithinScope: 0,
        status: "ready",
        ref: ref("api-0"),
      },
      {
        scopeId: apiScopeId,
        runId: firstRunId,
        appRunOrdinal: null,
        ordinalWithinScope: 1,
        status: "ready",
        ref: ref("api-1"),
      },
      {
        scopeId: webScopeId,
        runId: null,
        appRunOrdinal: null,
        ordinalWithinScope: 1,
        status: "ready",
        ref: ref("web-1"),
      },
      {
        scopeId: webScopeId,
        runId: secondRunId,
        appRunOrdinal: null,
        ordinalWithinScope: 2,
        status: "ready",
        ref: ref("web-2"),
      },
    ],
  };
  const diffCheckpoints = vi.fn((input: CheckpointStore.DiffCheckpointsInput) =>
    Effect.succeed(`diff --git a/${input.pathPrefix}/x b/${input.pathPrefix}/x\n`),
  );
  const layer = makeLayer({ projection: Effect.succeed(projection), diffCheckpoints });

  return Effect.gen(function* () {
    const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const turnTwo = yield* query.getTurnDiff({ threadId, fromTurnCount: 1, toTurnCount: 2 });
    assert.equal(turnTwo.diff, "diff --git a/web/x b/web/x\n");
    assert.deepEqual(
      diffCheckpoints.mock.calls.map(([input]) => [input.fromCheckpointRef, input.toCheckpointRef]),
      [[ref("web-1"), ref("web-2")]],
    );

    // Turn 1 ends at api's own checkpoint, not at a later run's baseline at the same ordinal.
    diffCheckpoints.mockClear();
    yield* query.getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 1 });
    assert.deepEqual(
      diffCheckpoints.mock.calls.map(([input]) => [input.fromCheckpointRef, input.toCheckpointRef]),
      [[ref("api-0"), ref("api-1")]],
    );

    const whole = yield* query.getFullThreadDiff({ threadId, toTurnCount: 2 });
    assert.equal(whole.diff, "diff --git a/api/x b/api/x\ndiff --git a/web/x b/web/x\n");
  }).pipe(Effect.provide(layer));
});
