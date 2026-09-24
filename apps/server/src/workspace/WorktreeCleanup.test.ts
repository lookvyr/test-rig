// @effect-diagnostics nodeBuiltinImport:off
import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
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
  OrchestrationThreadShell,
  ProjectId,
  ProviderDriverKind,
  type TerminalSummary,
} from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { GitManager } from "../git/GitManager.ts";
import * as Cleanup from "./WorktreeCleanup.ts";
import * as State from "./WorktreeCleanupState.ts";

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

const decodeThread = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeThreadId = Schema.decodeUnknownSync(OrchestrationThreadShell.fields.id);
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
    modelSelection: { instanceId: "codex", model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "task",
    worktreePath: checkout,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: "settled",
    settledAt: now,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });
  let threads = [thread];
  let enabled = true;
  let merged = false;
  let afterRemote = () => {};
  let terminals: TerminalSummary[] = [];
  let afterStop = () => {};
  let sessions: ReturnType<typeof ProviderService.of>["listSessions"] = () => Effect.succeed([]);
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
    Layer.provideMerge(State.layer),
    Layer.provide(Layer.mock(CheckpointReactor, { drain: Effect.void })),
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
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery, {
        getShellSnapshot: () =>
          Effect.sync(() => ({
            snapshotSequence: 1,
            projects: [project],
            threads,
            updatedAt: now,
          })),
        getArchivedShellSnapshot: () =>
          Effect.succeed({ snapshotSequence: 1, projects: [], threads: [], updatedAt: now }),
      }),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngineService, {
        streamDomainEvents: Stream.empty,
        dispatch: (command) =>
          Effect.sync(() => {
            if (command.type === "thread.settle")
              threads = threads.map((entry) =>
                entry.id === command.threadId
                  ? { ...entry, settledOverride: "settled", settledAt: now }
                  : entry,
              );
            return { sequence: 1 };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderService, {
        listSessions: () => sessions(),
        stopSession: () => Effect.sync(afterStop),
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
  const state = Context.get(context, State.WorktreeCleanupState);
  return {
    repo,
    checkout,
    thread,
    state,
    sweep: () => service.sweep.pipe(Effect.provide(context)),
    start: () => service.start().pipe(Effect.provide(context)),
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
      sessions = () =>
        Effect.succeed([
          {
            threadId: thread.id,
            provider: ProviderDriverKind.make("codex"),
            status: "ready",
            cwd: checkout,
            runtimeMode: "full-access",
            model: "test",
            createdAt: now,
            updatedAt: now,
          },
        ]);
    },
  };
});

describe("settled worktree cleanup", () => {
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
        updatedAt: f.thread.createdAt,
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
          latestUserMessageAt: DateTime.formatIso(yield* DateTime.now),
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
      f.setThreads([{ ...f.thread, backgroundLiveness: "working" }]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)?.state).toBe("pending");
    }),
  );
});
