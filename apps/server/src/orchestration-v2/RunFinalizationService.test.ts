import { assert, it, vi } from "@effect/vitest";
import {
  CheckpointScopeId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as EventSink from "./EventSink.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as RunFinalization from "./RunFinalizationService.ts";

it.effect("tool completion only checks for a changed local branch", () => {
  const refreshLocalStatus = vi.fn(() =>
    Effect.succeed({
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
    }),
  );
  const layer = RunFinalization.observerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({}),
        Layer.mock(PullRequestService.PullRequestService)({}),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({ refreshLocalStatus }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const observer = yield* RunFinalization.RunFinalizationObserver;
    yield* observer.refreshAfterTool("/active-worktree");
    assert.deepEqual(refreshLocalStatus.mock.calls, [
      ["/active-worktree", { onlyIfBranchChanged: true }],
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("refreshes workspace after checkpoint capture without reading history", () => {
  const threadId = ThreadId.make("thread_finalize");
  const runId = RunId.make("run_finalize");
  const scopeId = CheckpointScopeId.make("scope_finalize");
  const capture = vi.fn(() => Effect.void);
  const refresh = vi.fn(() => Effect.void);
  const checkpointContext = {
    runs: [],
    checkpointScopes: [{ id: scopeId, runId, kind: "root_run" as const, cwd: "/repo" }],
    checkpoints: [],
  };
  const layer = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.mock(CheckpointCapture.CheckpointCaptureServiceV2)({ execute: capture }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadProjection: () =>
            Effect.die("workspace refresh must not load transcript history"),
          getCheckpointContext: () => Effect.succeed(checkpointContext),
        }),
        Layer.succeed(RunFinalization.RunFinalizationObserver, {
          refresh,
          refreshAfterTool: () => Effect.void,
          refreshAfterTurn: () => Effect.void,
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* RunFinalization.RunFinalizationService;
    yield* service.finalize({ threadId, runId, scopeId });
    assert.equal(capture.mock.calls.length, 1);
    assert.deepEqual(refresh.mock.calls[0], [{ cwd: "/repo", threadId, runId }]);
  }).pipe(Effect.provide(layer));
});

it.effect.each(
  (
    [
      {
        label: "discovers a new PR for the completed run's branch",
        branch: "feature",
        checkedOut: "feature",
        activeRun: null,
        expected: ["/repo"],
      },
      {
        label: "leaves the default branch's PR cache alone",
        branch: "main",
        checkedOut: "main",
        activeRun: null,
        expected: [],
      },
      {
        label: "does not refresh another thread's checkout",
        branch: "feature",
        checkedOut: "other",
        activeRun: null,
        expected: [],
      },
      {
        label: "does not refresh during a newer active run",
        branch: "feature",
        checkedOut: "feature",
        activeRun: "newer-run",
        expected: [],
      },
    ] as const
  ).map((scenario) => [scenario.label, scenario] as const),
)("%s", ([, scenario]) => {
  const refreshed: string[] = [];
  const threadId = ThreadId.make("thread-pr-refresh");
  const runId = RunId.make("completed-run");
  const layer = RunFinalization.observerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
        Layer.mock(PullRequestService.PullRequestService)({
          refreshAfterTurn: () => Effect.void,
        }),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
          refreshLocalStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: true,
              isDefaultRef: scenario.checkedOut === "main",
              refName: scenario.checkedOut,
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          refreshStatus: () =>
            Effect.die("turn completion must preserve known PRs and lookup backoff"),
          refreshPullRequestStatus: (cwd) =>
            Effect.sync(() => {
              refreshed.push(cwd);
              return null;
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getShellSnapshot: () =>
            Effect.succeed({
              threads: [],
              archivedThreads: [],
              schemaVersion: 1,
              snapshotSequence: 0,
            }),
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              branch: scenario.branch,
              worktreePath: "/other-repo",
              activeRunId: scenario.activeRun === null ? null : RunId.make(scenario.activeRun),
            } as OrchestrationV2ThreadShell),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const observer = yield* RunFinalization.RunFinalizationObserver;
    yield* observer.refresh({ cwd: "/repo", threadId, runId });
    assert.deepEqual(refreshed, [...scenario.expected]);
  }).pipe(Effect.provide(layer));
});

it.effect.each([
  { branch: null, otherActive: false, committed: true },
  { branch: "dev", otherActive: false, committed: true },
  { branch: "dev", otherActive: true, committed: true },
  { branch: "dev", otherActive: false, committed: false },
])(
  "adopts local branch metadata (%s) before discovering a PR",
  ({ branch, otherActive, committed }) => {
    const threadId = ThreadId.make("local-thread");
    const runId = RunId.make("local-run");
    const thread = {
      id: threadId,
      projectId: "project",
      branch,
      worktreePath: null,
      activeRunId: runId,
    } as OrchestrationV2ThreadShell;
    const write = vi.fn<EventSink.EventSinkV2["Service"]["writeIfThreadUnchanged"]>(() =>
      Effect.succeed({ committed, storedEvents: [] }),
    );
    const refreshPullRequestStatus = vi.fn(() => Effect.succeed(null));
    return Effect.gen(function* () {
      const observer = yield* RunFinalization.RunFinalizationObserver;
      yield* observer.refresh({ cwd: "/repo", threadId, runId });
      if (otherActive) {
        assert.equal(write.mock.calls.length, 0);
        assert.equal(refreshPullRequestStatus.mock.calls.length, 0);
        return;
      }
      assert.equal(write.mock.calls.length, 1);
      const event = write.mock.calls[0]?.[0].events[0];
      assert.equal(event?.type, "thread.metadata-updated");
      if (event?.type !== "thread.metadata-updated") throw new Error("Expected metadata event");
      assert.equal(event.payload.branch, "feature");
      assert.deepEqual(refreshPullRequestStatus.mock.calls, committed ? [["/repo"]] : []);
    }).pipe(
      Effect.provide(
        RunFinalization.observerLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
              Layer.mock(PullRequestService.PullRequestService)({}),
              Layer.mock(ProjectStore.ProjectStoreV2)({
                listShells: () =>
                  Effect.succeed([{ id: "project", workspaceRoot: "/repo" }] as never),
              }),
              Layer.mock(EventSink.EventSinkV2)({ writeIfThreadUnchanged: write }),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getThreadShell: () => Effect.succeed(thread),
                getThread: () => Effect.succeed(thread as never),
                getShellSnapshot: () =>
                  Effect.succeed({
                    threads: [
                      thread,
                      {
                        ...thread,
                        id: ThreadId.make("sibling"),
                        activeRunId: otherActive ? RunId.make("other-run") : null,
                      },
                    ],
                    archivedThreads: [],
                    schemaVersion: 1,
                    snapshotSequence: 0,
                  }),
              }),
              Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
                refreshLocalStatus: () =>
                  Effect.succeed({
                    isRepo: true,
                    hasPrimaryRemote: true,
                    isDefaultRef: false,
                    refName: "feature",
                    hasWorkingTreeChanges: false,
                    workingTree: { files: [], insertions: 0, deletions: 0 },
                  }),
                refreshPullRequestStatus,
              }),
            ),
          ),
        ),
      ),
    );
  },
);
