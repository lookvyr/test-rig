// @effect-diagnostics nodeBuiltinImport:off
import { EffectOutboxV2 } from "./orchestration-v2/EffectOutbox.ts";
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
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  DEFAULT_SERVER_SETTINGS,
  OrchestrationV2ThreadShell,
  type ServerSettings,
  ProviderSessionId,
  ThreadId,
  ProjectId,
  type TaskFolder,
  type TerminalSummary,
} from "@t3tools/contracts";
import { ServerConfig } from "./config.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ProjectStoreV2 } from "./orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "./orchestration-v2/ThreadManagementService.ts";
import { ProviderSessionManagerV2 } from "./orchestration-v2/ProviderSessionManager.ts";
import { TerminalManager } from "./terminal/Manager.ts";
import { GitVcsDriver } from "./vcs/GitVcsDriver.ts";
import { GitManager } from "./git/GitManager.ts";
import * as Cleanup from "./storageCleanup.ts";
import * as TaskFolders from "./workspace/TaskFolders.ts";

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
const fixtureWith = (taskFoldersLayer: Layer.Layer<TaskFolders.TaskFolders>) =>
  Effect.gen(function* () {
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
    let settings: ServerSettings = DEFAULT_SERVER_SETTINGS;
    let merged = false;
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
      Layer.provide(taskFoldersLayer),
      Layer.provide(
        Layer.mock(EffectOutboxV2, {
          hasPendingWorkspaceEffects: () => Effect.sync(() => pendingWorkspaceEffects),
        }),
      ),
      Layer.provide(ServerConfig.layerTest(repo, root)),
      Layer.provide(
        Layer.mock(ServerSettingsService, {
          getSettings: Effect.sync(() => settings),
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
          execute: (input) =>
            Effect.sync(() => {
              const result = NodeChildProcess.spawnSync("git", [...input.args], {
                cwd: input.cwd,
                encoding: "utf8",
              });
              if (result.status !== 0 && input.allowNonZeroExit !== true)
                throw new Error(`git ${input.args.join(" ")} failed: ${result.stderr}`);
              return {
                exitCode: ChildProcessSpawner.ExitCode(result.status ?? 1),
                stdout: result.stdout,
                stderr: result.stderr,
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
          resolveCommit: (input) =>
            Effect.sync(() => ({ commitSha: git(input.cwd, "rev-parse", input.revision).trim() })),
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
    const service = Context.get(context, Cleanup.StorageCleanup);
    const state = {
      get: (id: ThreadId) => threads.find((thread) => thread.id === id)?.worktreeCleanup ?? null,
    };
    return {
      repo,
      checkout,
      thread,
      state,
      sweep: (mode: Cleanup.StorageCleanupMode = "quick") =>
        service.sweep(mode).pipe(Effect.provide(context)),
      start: () => service.start().pipe(Effect.provide(context)),
      pendingEffects: (value: boolean) => {
        pendingWorkspaceEffects = value;
      },
      residencies: (value: typeof sessions) => {
        sessions = value;
      },
      enable: (value: boolean) => {
        settings = {
          ...settings,
          storageCleanup: {
            ...settings.storageCleanup,
            worktreeSettledAfterDays: value ? 0 : null,
          },
        };
      },
      rules: (value: Partial<ServerSettings["storageCleanup"]>) => {
        settings = { ...settings, storageCleanup: { ...settings.storageCleanup, ...value } };
      },
      settings: (value: Partial<ServerSettings>) => {
        settings = { ...settings, ...value };
      },
      config: yield* ServerConfig.pipe(
        Effect.provide(ServerConfig.layerTest(repo, root).pipe(Layer.provide(NodeServices.layer))),
      ),
      latestReport: () => service.latestReport,
      setThreads: (value: typeof threads) => {
        threads = value;
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
const fixture = fixtureWith(TaskFolders.layerTest);

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
  it.effect.each([false, true])(
    "waits for durable settlement before deleting a merged PR checkout (auto-settle disabled: %s)",
    (disabled) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        f.setThreads([
          {
            ...f.thread,
            settledOverride: null,
            settledAt: null,
            autoSettleDisabledAt: disabled ? f.thread.createdAt : null,
          },
        ]);
        f.merge();
        yield* f.sweep();
        expect(NodeFS.existsSync(f.checkout)).toBe(true);
        f.setThreads([f.thread]);
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
  it.effect("waits for an on-settle action that just started", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.terminal({
        threadId: f.thread.id,
        terminalId: "settle-cleanup-1a2b3c4d",
        cwd: f.checkout,
        worktreePath: f.checkout,
        status: "running",
        pid: 123,
        exitCode: null,
        exitSignal: null,
        hasRunningSubprocess: false,
        label: "Terminal",
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      });
      yield* f.start();
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
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
  it.effect("lets a side chat follow its settled parent", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const sideChat = {
        ...f.thread,
        id: decodeThreadId("side-chat"),
        // The branch it was opened on; the parent's branch has moved on since.
        branch: "opened-on-branch",
        settledOverride: null,
        settledAt: null,
        lineage: {
          parentThreadId: f.thread.id,
          relationshipToParent: "fork" as const,
          rootThreadId: f.thread.id,
          sideChat: true,
        },
      };
      f.setThreads([{ ...f.thread, settledOverride: "active", settledAt: null }, sideChat]);
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      f.setThreads([f.thread, sideChat]);
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

describe("worktree cleanup rules", () => {
  it.live("waits out a settled-days rule before removing", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeSettledAfterDays: 3650 });
      const kept = yield* f.sweep("manual");
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)).toBeNull();
      expect(kept.entries[0]?.reason).toMatch(/^Settled for \d+ of 3650 days$/);
      f.rules({ worktreeSettledAfterDays: 30 });
      const removed = yield* f.sweep("manual");
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
      expect(removed.entries[0]).toMatchObject({ outcome: "removed", path: f.checkout });
      expect(removed.counts.removed).toBe(1);
    }),
  );
  it.live("removes an inactive worktree whose thread never settled", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null, settledAt: null }]);
      f.rules({ worktreeAfterDays: 3650 });
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      f.rules({ worktreeAfterDays: 30 });
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.live("keeps an inactive worktree with changes without flagging its active thread", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null, settledAt: null }]);
      f.rules({ worktreeSettledAfterDays: null, worktreeAfterDays: 30 });
      NodeFS.writeFileSync(NodePath.join(f.checkout, "tracked.txt"), "changed");
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)?.state).toBeUndefined();
    }),
  );
  it.live("removes untracked files when only edited tracked files count", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeKeepWhen: "tracked-changes" });
      NodeFS.writeFileSync(NodePath.join(f.checkout, "scratch.txt"), "throwaway");
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.live("keeps ignored files when any local file counts", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeKeepWhen: "any-local-files" });
      NodeFS.mkdirSync(NodePath.join(f.checkout, "node_modules"));
      NodeFS.writeFileSync(NodePath.join(f.checkout, "node_modules", "cache"), "fine");
      yield* f.sweep();
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.live("keeps a worktree holding an ignored .env when any local file counts", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeKeepWhen: "any-local-files" });
      NodeFS.writeFileSync(NodePath.join(f.checkout, ".env"), "SECRET=1");
      const result = yield* f.sweep("manual");
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(f.state.get(f.thread.id)).toEqual({
        state: "retained",
        reason: "Worktree kept because it has local files.",
      });
      expect(result.entries[0]?.reason).toBe("Has ignored files (.env)");
    }),
  );
  it.live("removes an unchanged worktree only on a full pass", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeSettledAfterDays: null, worktreeUnchanged: true });
      yield* f.sweep("quick");
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      yield* f.sweep("automatic");
      expect(NodeFS.existsSync(f.checkout)).toBe(false);
    }),
  );
  it.live("never treats an unsettled thread's worktree as unchanged", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.setThreads([{ ...f.thread, settledOverride: null, settledAt: null }]);
      f.rules({
        worktreeSettledAfterDays: null,
        worktreeUnchanged: true,
        worktreeKeepWhen: "tracked-changes",
      });
      NodeFS.writeFileSync(NodePath.join(f.checkout, "draft.txt"), "uncommitted work");
      yield* f.sweep("manual");
      expect(NodeFS.existsSync(NodePath.join(f.checkout, "draft.txt"))).toBe(true);
    }),
  );
  it.live("keeps a worktree with commits beyond the project branch", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.rules({ worktreeSettledAfterDays: null, worktreeUnchanged: true });
      git(f.checkout, "commit", "--allow-empty", "-m", "work");
      const result = yield* f.sweep("manual");
      expect(NodeFS.existsSync(f.checkout)).toBe(true);
      expect(result.entries[0]?.reason).toBe("Has commits beyond the project branch");
    }),
  );
  it.live("cleans worktrees in a folder the worktree location moved away from", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const previous = NodePath.join(NodePath.dirname(f.repo), "elsewhere");
      const checkout = NodePath.join(previous, "repo", "moved");
      git(f.repo, "worktree", "add", "-b", "moved", checkout);
      f.setThreads([{ ...f.thread, worktreePath: checkout, branch: "moved" }]);
      yield* f.sweep();
      expect(NodeFS.existsSync(checkout)).toBe(true);
      f.settings({ worktreesDirectory: "", previousWorktreesDirectories: [previous] });
      yield* f.sweep();
      expect(NodeFS.existsSync(checkout)).toBe(false);
    }),
  );
  it.live("deletes expired browser artifacts and rotated logs on a full pass", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const old = DateTime.toDateUtc(DateTime.subtract(yield* DateTime.now, { days: 40 }));
      const write = (file: string, stale: boolean) => {
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        NodeFS.writeFileSync(file, "x");
        if (stale) NodeFS.utimesSync(file, old, old);
      };
      write(NodePath.join(f.config.browserArtifactsDir, "old.png"), true);
      write(NodePath.join(f.config.browserArtifactsDir, "new.png"), false);
      write(NodePath.join(f.config.logsDir, "server.log.1"), true);
      write(NodePath.join(f.config.logsDir, "server.log"), true);
      f.rules({ browserArtifactsAfterDays: 30, logsAfterDays: 30 });
      yield* f.sweep("quick");
      expect(NodeFS.existsSync(NodePath.join(f.config.browserArtifactsDir, "old.png"))).toBe(true);
      const result = yield* f.sweep("manual");
      expect(NodeFS.existsSync(NodePath.join(f.config.browserArtifactsDir, "old.png"))).toBe(false);
      expect(NodeFS.existsSync(NodePath.join(f.config.browserArtifactsDir, "new.png"))).toBe(true);
      expect(NodeFS.existsSync(NodePath.join(f.config.logsDir, "server.log.1"))).toBe(false);
      // The current log is never rotated-out, however old.
      expect(NodeFS.existsSync(NodePath.join(f.config.logsDir, "server.log"))).toBe(true);
      expect(result.trigger).toBe("manual");
      expect(result.entries.filter((entry) => entry.kind !== "worktree")).toMatchObject([
        { kind: "browser-artifacts", outcome: "removed", files: 1 },
        { kind: "logs", outcome: "removed", files: 1 },
      ]);
      expect(yield* f.latestReport()).toEqual(result);
    }),
  );
});

describe("storageCleanupPullRequestMerged", () => {
  const worktree = { branch: "task", defaultBranch: "main", integrated: false, headOnRemote: true };
  const pr = { state: "merged" as const, headRef: "task", baseRef: "main" };
  it("accepts a squash-merged PR for this branch whose commits reached the remote", () => {
    expect(Cleanup.storageCleanupPullRequestMerged(pr, worktree)).toBe(true);
  });
  it("rejects local commits made after the merge, open PRs and other branches", () => {
    expect(Cleanup.storageCleanupPullRequestMerged(pr, { ...worktree, headOnRemote: false })).toBe(
      false,
    );
    expect(Cleanup.storageCleanupPullRequestMerged({ ...pr, state: "open" }, worktree)).toBe(false);
    expect(Cleanup.storageCleanupPullRequestMerged({ ...pr, headRef: "other" }, worktree)).toBe(
      false,
    );
    expect(Cleanup.storageCleanupPullRequestMerged(null, worktree)).toBe(false);
  });
});

describe("task folder cleanup", () => {
  const stub = (state: {
    taskFolder: TaskFolder | undefined;
    calls: Array<Parameters<TaskFolders.TaskFolders["Service"]["remove"]>[0]>;
    verdicts: Array<string | null>;
  }) =>
    Layer.succeed(
      TaskFolders.TaskFolders,
      TaskFolders.TaskFolders.of({
        covers: () => Effect.succeed(true),
        find: (target) =>
          Effect.succeed(
            state.taskFolder !== undefined && target === state.taskFolder.projectPath
              ? Option.some(state.taskFolder)
              : Option.none(),
          ),
        create: () => Effect.die("unused"),
        addRepository: () => Effect.die("unused"),
        remove: (input) =>
          Effect.gen(function* () {
            state.calls.push(input);
            const verdicts = yield* Effect.forEach(input.taskFolder.repositories, (checkout) =>
              input.inspect!(checkout),
            );
            state.verdicts.push(...verdicts);
            return {
              removed: input.taskFolder.repositories
                .filter((_, index) => verdicts[index] === null)
                .map((checkout) => checkout.worktreePath),
              kept: input.taskFolder.repositories.flatMap((checkout, index) =>
                verdicts[index] === null
                  ? []
                  : [{ path: checkout.worktreePath, reason: verdicts[index]! }],
              ),
            };
          }),
        restore: () => Effect.succeed(false),
      }),
    );

  it.effect("removes a settled thread's task folder checkout by checkout, keeping its record", () =>
    Effect.gen(function* () {
      const state = {
        taskFolder: undefined as TaskFolder | undefined,
        calls: [] as Array<Parameters<TaskFolders.TaskFolders["Service"]["remove"]>[0]>,
        verdicts: [] as Array<string | null>,
      };
      const f = yield* fixtureWith(stub(state));
      state.taskFolder = {
        root: NodePath.dirname(f.checkout),
        projectId: ProjectId.make("project-1"),
        projectRoot: f.repo,
        anchor: f.repo,
        projectPath: f.checkout,
        projectIsWorktree: false,
        repositories: [{ name: "repo", repositoryPath: f.repo, worktreePath: f.checkout }],
        baseRef: "main",
      };
      // Local work in one checkout keeps it.
      NodeFS.writeFileSync(NodePath.join(f.checkout, "tracked.txt"), "changed\n");
      const kept = yield* f.sweep("manual");
      expect(state.calls[0]).toMatchObject({ force: false, keepRecord: true });
      expect(state.verdicts[0]).toMatch(/^has uncommitted changes/);
      expect(kept.entries[0]).toMatchObject({ outcome: "kept", path: f.checkout });

      git(f.checkout, "checkout", "--", "tracked.txt");
      const removed = yield* f.sweep("manual");
      expect(state.verdicts[1]).toBeNull();
      expect(removed.entries[0]).toMatchObject({ outcome: "removed", path: f.checkout });
    }),
  );

  it.effect("leaves a task folder alone for merged and unchanged rules", () =>
    Effect.gen(function* () {
      const state = {
        taskFolder: undefined as TaskFolder | undefined,
        calls: [] as Array<Parameters<TaskFolders.TaskFolders["Service"]["remove"]>[0]>,
        verdicts: [] as Array<string | null>,
      };
      const f = yield* fixtureWith(stub(state));
      state.taskFolder = {
        root: NodePath.dirname(f.checkout),
        projectId: ProjectId.make("project-1"),
        projectRoot: f.repo,
        anchor: f.repo,
        projectPath: f.checkout,
        projectIsWorktree: false,
        repositories: [{ name: "repo", repositoryPath: f.repo, worktreePath: f.checkout }],
        baseRef: "main",
      };
      f.rules({ worktreeSettledAfterDays: null, worktreeUnchanged: true, worktreeOnMerge: true });
      const result = yield* f.sweep("manual");
      expect(state.calls).toHaveLength(0);
      expect(result.entries[0]?.outcome).toBe("kept");
    }),
  );
});
