// @effect-diagnostics nodeBuiltinImport:off
import { EffectOutboxV2 } from "../orchestration-v2/EffectOutbox.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import {
  DEFAULT_SERVER_SETTINGS,
  OrchestrationV2ThreadShell,
  ProviderSessionId,
  ThreadId,
  ProjectId,
  type TerminalSummary,
} from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { GitManager } from "../git/GitManager.ts";
import * as Cleanup from "./WorktreeCleanup.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const decodeThread = Schema.decodeUnknownSync(Schema.toCodecIso(OrchestrationV2ThreadShell));
const decodeThreadId = Schema.decodeUnknownSync(OrchestrationV2ThreadShell.fields.id);
const fixture = Effect.gen(function* () {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-cleanup-")),
  );
  roots.push(root);
  const repo = NodePath.join(root, "repo");
  NodeFS.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Cleanup test");
  git(repo, "config", "user.email", "cleanup@example.invalid");
  NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "original\n");
  NodeFS.writeFileSync(
    NodePath.join(repo, ".gitignore"),
    "node_modules/\n.env\n.husky/_/\ndist/\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const worktreesDir = NodePath.join(root, "worktrees");
  NodeFS.mkdirSync(worktreesDir, { recursive: true });
  const checkout = NodePath.join(worktreesDir, "task");
  git(repo, "worktree", "add", "-b", "task", checkout);
  const now = "2026-09-17T10:00:00.000Z";
  const thread = decodeThread({
    id: "thread-1",
    projectId: "project-1",
    title: "Cleanup test",
    createdBy: "user",
    creationSource: "web",
    modelSelection: { instanceId: "codex", model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "task",
    worktreePath: checkout,
    providerInstanceId: "codex",
    activeProviderThreadId: null,
    lineage: { rootThreadId: "thread-1", parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: DateTime.makeUnsafe(now),
    updatedAt: DateTime.makeUnsafe(now),
    archivedAt: null,
    deletedAt: null,
    settledOverride: "settled",
    settledAt: DateTime.makeUnsafe(now),
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
  });
  let threads = [thread];
  let enabled = true;
  let merged = false;
  let afterRemote = () => {};
  let terminals: TerminalSummary[] = [];
  let afterStop = () => {};
  let sessions: Effect.Success<ProviderSessionManagerV2["Service"]["residencies"]> = [];
  let pendingWorkspaceEffects = false;
  const project = {
    id: ProjectId.make("project-1"),
    title: "Fixture",
    workspaceRoot: repo,
    scripts: [],
    defaultModelSelection: null,
    createdAt: now,
    updatedAt: now,
  };
  const layer = Cleanup.layer.pipe(
    Layer.provide(
      Layer.mock(EffectOutboxV2, {
        hasPendingWorkspaceEffects: () => Effect.sync(() => pendingWorkspaceEffects),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(repo, root)),
    Layer.provide(
      Layer.mock(ServerSettingsService, {
        getSettings: Effect.sync(() => ({
          ...DEFAULT_SERVER_SETTINGS,
          autoRemoveSettledWorktrees: enabled,
        })),
        subscribeChanges: Effect.succeed(Stream.empty),
      }),
    ),
    Layer.provide(Layer.mock(ProjectStoreV2, { listShells: () => Effect.succeed([project]) })),
    Layer.provide(
      Layer.mock(ThreadManagementService, {
        getShellSnapshot: () =>
          Effect.sync(() => ({
            schemaVersion: 2,
            snapshotSequence: 1,
            threads,
            archivedThreads: [],
          })),
        streamDomainEvents: Stream.empty,
        dispatch: (command) =>
          Effect.sync(() => {
            if (command.type === "thread.auto-settle")
              threads = threads.map((entry) =>
                entry.id === command.threadId
                  ? { ...entry, settledOverride: "settled", settledAt: DateTime.makeUnsafe(now) }
                  : entry,
              );
            if (command.type === "thread.worktree-cleanup.set")
              threads = threads.map((entry) =>
                entry.id === command.threadId
                  ? { ...entry, worktreeCleanup: command.status }
                  : entry,
              );
            return { sequence: 1, storedEvents: [] };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderSessionManagerV2, {
        residencies: Effect.sync(() => sessions),
        close: () =>
          Effect.sync(() => {
            afterStop();
            sessions = [];
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(TerminalManager, {
        subscribeMetadata: (listener) =>
          listener({ type: "snapshot", terminals }).pipe(Effect.as(() => {})),
        close: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver, {
        statusDetailsLocal: (cwd) =>
          Effect.sync(() => ({
            isRepo: true,
            hasOriginRemote: false,
            isDefaultBranch: false,
            branch: git(cwd, "branch", "--show-current").trim(),
            upstreamRef: null,
            hasWorkingTreeChanges: git(cwd, "status", "--porcelain").length > 0,
            workingTree: { files: [], insertions: 0, deletions: 0 },
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            aheadOfDefaultCount: 0,
          })),
        removeWorktree: (input) =>
          Effect.sync(() => {
            expect(input.force).toBe(false);
            git(input.cwd, "worktree", "remove", input.path);
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(GitManager, {
        remoteStatus: () =>
          Effect.sync(() => {
            afterRemote();
            return {
              hasUpstream: false,
              aheadCount: 0,
              behindCount: 0,
              pr: merged
                ? {
                    number: 1,
                    title: "Merged",
                    url: "https://example.invalid/pr/1",
                    baseRef: "main",
                    headRef: "task",
                    state: "merged" as const,
                  }
                : null,
            };
          }),
        invalidateStatus: () => Effect.void,
      }),
    ),
    Layer.provide(NodeServices.layer),
  );
  const context = yield* Layer.build(layer);
  const service = Context.get(context, Cleanup.WorktreeCleanup);
  const state = {
    get: (id: ThreadId) => threads.find((thread) => thread.id === id)?.worktreeCleanup ?? null,
  };
  return {
    repo,
    checkout,
    thread,
    state,
    sweep: () => service.sweep.pipe(Effect.provide(context)),
    start: () => service.start().pipe(Effect.provide(context)),
    pendingEffects: (value: boolean) => {
      pendingWorkspaceEffects = value;
    },
    residencies: (value: typeof sessions) => {
      sessions = value;
    },
    enable: (value: boolean) => {
      enabled = value;
    },
    setThreads: (value: typeof threads) => {
      threads = value;
    },
    onRemote: (callback: () => void) => {
      afterRemote = callback;
    },
    merge: () => {
      merged = true;
    },
    terminal: (value: TerminalSummary) => {
      terminals = [value];
    },
    onStop: (callback: () => void) => {
      afterStop = callback;
      sessions = [
        {
          providerSessionId: ProviderSessionId.make("session1"),
          threadIds: [thread.id],
          cwd: checkout,
          busy: false,
          closing: false,
        },
      ];
    },
  };
});

describe("settled worktree cleanup", () => {
  it.effect("waits for pending or delayed checkpoint work and retries after it drains", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.pendingEffects(true);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)?.reason).toContain("checkpoint");
      f.pendingEffects(false);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.effect.each(["closing", "busy", "foreign"])("waits for a %s residency", (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.residencies([
        {
          providerSessionId: ProviderSessionId.make("session1"),
          cwd: f.checkout,
          threadIds: [kind === "foreign" ? ThreadId.make("other") : f.thread.id],
          closing: kind === "closing",
          busy: kind === "busy",
        },
      ]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect.each(["node_modules/cache", ".env", ".husky/_/husky.sh", "dist/app.js"])(
    "removes a clean checkout containing ignored %s, preserving the branch",
    (name) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const file = NodePath.join(f.checkout, name);
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        NodeFS.writeFileSync(file, "local fixture");
        expect(git(f.checkout, "status", "--porcelain")).toBe("");
        expect(git(f.checkout, "check-ignore", name).trim()).toBe(name);
        yield* f.sweep();
        expect(NodeFS.existsSync(f.checkout)).toBe(false);
        expect(git(f.repo, "rev-parse", "task").trim()).toBe(
          git(f.repo, "rev-parse", "main").trim(),
        );
        expect(f.state.get(f.thread.id)).toBeNull();
      }),
  );
  it.effect.each(["unstaged", "staged", "untracked"])("keeps %s work and explains why", (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const name = kind === "untracked" ? "untracked.txt" : "tracked.txt";
      NodeFS.writeFileSync(NodePath.join(f.checkout, name), "keep me");
      if (kind === "staged") git(f.checkout, "add", name);
      yield* f.sweep();
      expect(NodeFS.readFileSync(NodePath.join(f.checkout, name), "utf8")).toBe("keep me");
      expect(f.state.get(f.thread.id)).toEqual({
        state: "retained",
        reason: "Worktree kept because it has uncommitted changes.",
      });
    }),
  );
  it.effect.each(["unstaged", "staged", "untracked"])(
    "keeps %s work created during session shutdown",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const name = kind === "untracked" ? "untracked.txt" : "tracked.txt";
        f.onStop(() => {
          NodeFS.writeFileSync(NodePath.join(f.checkout, name), "keep me");
          if (kind === "staged") git(f.checkout, "add", name);
        });
        yield* f.sweep();
        expect(NodeFS.readFileSync(NodePath.join(f.checkout, name), "utf8")).toBe("keep me");
        expect(f.state.get(f.thread.id)).toEqual({
          state: "retained",
          reason: "Worktree kept because its local files changed during cleanup.",
        });
      }),
  );
  it.effect("removes a checkout when only ignored files appear during session shutdown", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.onStop(() => NodeFS.writeFileSync(NodePath.join(f.checkout, ".env"), "local fixture"));
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
      expect(f.state.get(f.thread.id)).toBeNull();
    }),
  );
  it.effect("honors opt-out and clears existing notices", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      NodeFS.writeFileSync(NodePath.join(f.checkout, "tracked.txt"), "changed");
      yield* f.sweep();
      f.enable(false);
      yield* f.sweep();
      expect(f.state.get(f.thread.id)).toBeNull();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect("keeps a checkout shared with an active thread", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([
        f.thread,
        {
          ...f.thread,
          id: decodeThreadId("thread-2"),
          settledOverride: "active",
          settledAt: null,
        },
      ]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect("settles merged PRs durably before deleting their checkout", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null, settledAt: null }]);
      f.merge();
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.effect("does not settle or remove a checkout for an unlinked or different PR", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.merge();
      for (const pullRequestAssociation of [
        { mode: "unlinked" } as const,
        {
          mode: "linked",
          provider: "github",
          reference: "https://github.com/other/repo/pull/99",
        } as const,
      ]) {
        f.setThreads([
          { ...f.thread, settledOverride: null, settledAt: null, pullRequestAssociation },
        ]);
        yield* f.sweep();
        expect(NodeFS.existsSync(f.checkout)).toBe(true);
      }
    }),
  );
  it.effect("respects a pin on a merged PR", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null, pinnedAt: f.thread.createdAt }]);
      f.merge();
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect.each(["reopen", "disable"])(
    "cancels removal when %s occurs during session shutdown",
    (action) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        f.onStop(() => {
          if (action === "disable") f.enable(false);
          else f.setThreads([{ ...f.thread, settledOverride: "active" }]);
        });
        yield* f.sweep();
        expect(NodeFS.existsSync(f.checkout)).toBe(true);
      }),
  );
  it.effect("waits for a running terminal job", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.terminal({
        threadId: f.thread.id,
        terminalId: "job",
        cwd: f.checkout,
        worktreePath: f.checkout,
        status: "running",
        pid: 123,
        exitCode: null,
        exitSignal: null,
        hasRunningSubprocess: true,
        label: "job",
        updatedAt: DateTime.formatIso(f.thread.createdAt),
      });
      yield* f.start();
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)?.reason).toContain("terminal job");
    }),
  );
  it.effect("removes a shared checkout only once every thread is settled", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([f.thread, { ...f.thread, id: decodeThreadId("thread-2") }]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.effect("leaves a checkout alone while a new user turn awaits provider startup", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([
        {
          ...f.thread,
          settledOverride: null,
          latestUserMessageAt: yield* DateTime.now,
        },
      ]);
      f.merge();
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect("respects a pin added while PR lookup is running", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null }]);
      f.merge();
      f.onRemote(() =>
        f.setThreads([{ ...f.thread, settledOverride: null, pinnedAt: f.thread.createdAt }]),
      );
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
    }),
  );
  it.effect("waits for background agents", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([
        { ...f.thread, pendingBackgroundTasks: [{ taskId: "child", kind: "subagent" }] },
      ]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)?.state).toBe("pending");
    }),
  );
});
