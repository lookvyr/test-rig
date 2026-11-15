import {
  CommandId,
  GitCommandError,
  sideChatParentThreadId,
  type OrchestrationV2ThreadShell,
  type ServerSettings,
  type ServerSettingsError,
  type StorageCleanupReport,
  type StorageCleanupReportEntry,
  type TerminalSummary,
  type WorktreeCleanupRules,
  type WorktreeKeepWhen,
} from "@t3tools/contracts";
import { resolveWorktreeT3Home } from "@t3tools/shared/devHome";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ServerConfig } from "./config.ts";
import { GitManager, type GitBranchPullRequest } from "./git/GitManager.ts";
import { EffectOutboxV2 } from "./orchestration-v2/EffectOutbox.ts";
import { ProjectStoreV2 } from "./orchestration-v2/ProjectStore.ts";
import { ProviderSessionManagerV2 } from "./orchestration-v2/ProviderSessionManager.ts";
import { ThreadManagementService } from "./orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "./serverActivation.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Manager.ts";
import { GitVcsDriver } from "./vcs/GitVcsDriver.ts";
import { withWorktreeLease } from "./workspace/worktreeLifecycle.ts";
import { isFilesystemRoot, managedWorktreesDirectories } from "./worktreesDirectory.ts";

type Thread = OrchestrationV2ThreadShell;
type Status = NonNullable<Thread["worktreeCleanup"]>;

/**
 * - `quick`: time-based worktree rules only. Runs on settlement changes and every minute.
 * - `automatic`: the hourly full pass, adding the Git-based rules, file retention and a report.
 * - `manual`: the same full pass, started from Settings → Maintenance → Delete now.
 */
export type StorageCleanupMode = "quick" | StorageCleanupReport["trigger"];

const DAY_MS = 86_400_000;
const REPORT_ENTRY_LIMIT = 200;
const isGitCommandError = Schema.is(GitCommandError);
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function cleanupFailureReason(error: { readonly message: string }) {
  return isGitCommandError(error)
    ? `${error.command}: ${error.detail.split(/\r?\n/)[0]}`
    : (error.message.split(/\r?\n/)[0] ?? error.message);
}

/** Test Rig does not delete worktrees with deleted threads, so `worktreeOnDelete` is ignored. */
export const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeSettledAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeUnchanged;

const sameWorktreeRules = (left: WorktreeCleanupRules, right: WorktreeCleanupRules) =>
  (Object.keys(left) as Array<keyof WorktreeCleanupRules>).every((key) => left[key] === right[key]);

/** A settlement never overrides active work, including provider background tasks. */
// An on-settle action is typed into its terminal before the subprocess poll can mark it busy,
// so a settle terminal touched moments ago counts as running.
const SETTLE_ACTION_GRACE_MS = 15_000;
function settleActionStarting(terminal: TerminalSummary, now: number): boolean {
  if (!terminal.terminalId.startsWith("settle-") || terminal.status === "exited") return false;
  const updatedAt = Date.parse(terminal.updatedAt);
  return Number.isNaN(updatedAt) || now - updatedAt < SETTLE_ACTION_GRACE_MS;
}

export function worktreeHasActiveThread(thread: Thread, now: number): boolean {
  const messageAt =
    thread.latestUserMessageAt == null
      ? -Infinity
      : DateTime.toEpochMillis(thread.latestUserMessageAt);
  const turnAt = Math.max(
    ...[thread.latestRunRequestedAt, thread.latestRunStartedAt, thread.latestRunCompletedAt].map(
      (at) => (at == null ? -Infinity : DateTime.toEpochMillis(at)),
    ),
  );
  return (
    (thread.status !== "failed" && messageAt > turnAt && Math.abs(now - messageAt) <= 120_000) ||
    thread.pendingRuntimeRequest != null ||
    (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
    thread.activityRunStatus != null ||
    thread.activeRunId != null ||
    thread.status === "queued"
  );
}

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt(thread: Thread): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

/**
 * Squash and rebase merges leave the branch's commits out of the default branch, so they
 * count only when the PR names this branch and its commits reached the remote.
 */
export function storageCleanupPullRequestMerged(
  pullRequest: Pick<GitBranchPullRequest, "state" | "headRef" | "baseRef"> | null,
  worktree: {
    readonly branch: string;
    readonly defaultBranch: string;
    readonly integrated: boolean;
    readonly headOnRemote: boolean;
  },
): boolean {
  return (
    pullRequest?.state === "merged" &&
    (worktree.integrated ||
      (pullRequest.headRef === worktree.branch &&
        pullRequest.baseRef === worktree.defaultBranch &&
        worktree.headOnRemote))
  );
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Runs one pass inline. Tests use it; production goes through the queued worker. */
    readonly sweep: (mode: StorageCleanupMode) => Effect.Effect<StorageCleanupReport>;
    readonly runNow: Effect.Effect<StorageCleanupReport, ServerSettingsError>;
    readonly latestReport: Effect.Effect<StorageCleanupReport | null>;
    readonly reports: Stream.Stream<StorageCleanupReport | null>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/storageCleanup") {}

export const make = Effect.gen(function* () {
  const outbox = yield* EffectOutboxV2;
  const config = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const settingsService = yield* ServerSettingsService;
  const projects = yield* ProjectStoreV2;
  const engine = yield* ThreadManagementService;
  const providers = yield* ProviderSessionManagerV2;
  const terminals = yield* TerminalManager;
  const git = yield* GitVcsDriver;
  const manager = yield* GitManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, TerminalSummary>();
  // A git worktree's dev home is seeded from real data, so its threads and any copied
  // settings can point at the developer's real worktrees.
  const isWorktreeDevHome =
    (yield* resolveWorktreeT3Home(config.baseDir)) === path.resolve(config.baseDir);
  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const atCheckout = (cwd: string, checkout: string) =>
    path.resolve(cwd) === checkout || inside(checkout, path.resolve(cwd));
  const checkoutTerminals = (checkout: string) =>
    [...liveTerminals.values()].filter(
      (terminal) =>
        (terminal.status === "running" || terminal.status === "starting") &&
        (atCheckout(terminal.cwd, checkout) ||
          (terminal.worktreePath != null && atCheckout(terminal.worktreePath, checkout))),
    );
  const readSnapshot = Effect.gen(function* () {
    const shell = yield* engine.getShellSnapshot();
    return {
      projects: yield* projects.listShells(),
      threads: [...shell.threads, ...shell.archivedThreads],
    };
  });
  const report = Effect.fn("StorageCleanup.report")(function* (
    thread: Thread,
    status: Status | null,
  ) {
    if (
      thread.worktreeCleanup?.state === status?.state &&
      thread.worktreeCleanup?.reason === status?.reason
    )
      return;
    yield* engine.dispatch({
      type: "thread.worktree-cleanup.set",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      threadId: thread.id,
      status,
    });
  });
  const ownSettled = (thread: Thread) =>
    thread.settledOverride === "settled" || thread.archivedAt !== null;
  /** A side chat has no settle control of its own, so it follows its parent in `threads`. */
  const settlementOwner = (threads: ReadonlyArray<Thread>, thread: Thread) => {
    const parentId = sideChatParentThreadId(thread.lineage);
    if (parentId === null) return thread;
    return threads.find((candidate) => candidate.id === parentId) ?? null;
  };
  const settledIn = (threads: ReadonlyArray<Thread>) => (thread: Thread) => {
    const owner = settlementOwner(threads, thread);
    return owner === null || ownSettled(owner);
  };
  /** When the thread (or a side chat's parent) settled; null while it is active. */
  const settledAtIn = (threads: ReadonlyArray<Thread>, thread: Thread, now: number) => {
    const owner = settlementOwner(threads, thread);
    if (owner === null) return now;
    if (!ownSettled(owner)) return null;
    const at = owner.settledOverride === "settled" ? owner.settledAt : null;
    return DateTime.toEpochMillis(at ?? owner.archivedAt ?? owner.updatedAt);
  };

  // Use git status directly: keep-when decides whether untracked and ignored files count.
  const localChangesReason = Effect.fn("StorageCleanup.localChangesReason")(function* (
    cwd: string,
    keepWhen: WorktreeKeepWhen,
  ) {
    const status = yield* git.execute({
      operation: "StorageCleanup.localChanges",
      cwd,
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--ignore-submodules=none",
        keepWhen === "tracked-changes" ? "--untracked-files=no" : "--untracked-files=all",
      ],
      maxOutputBytes: 64 * 1024,
      appendTruncationMarker: true,
    });
    if (status.stdoutTruncated) return "local changes exceed the inspection limit";
    const records = status.stdout.split("\0").filter(Boolean);
    let count = 0;
    for (let i = 0; i < records.length; i++) {
      count++;
      // Renames and copies carry their source path in the next record.
      if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
    }
    if (count > 0) return `has uncommitted changes (${count} ${count === 1 ? "file" : "files"})`;
    if (keepWhen !== "any-local-files") return null;
    const ignored = yield* git.execute({
      operation: "StorageCleanup.ignoredFiles",
      cwd,
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      maxOutputBytes: 64 * 1024,
      appendTruncationMarker: true,
    });
    if (ignored.stdoutTruncated) return "ignored files exceed the inspection limit";
    const file = ignored.stdout
      .split("\0")
      .find((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));
    return file === undefined ? null : `has ignored files (${file})`;
  });
  const retainedStatus = (reason: string): Status => ({
    state: "retained",
    reason: reason.startsWith("has ignored files")
      ? "Worktree kept because it has local files."
      : "Worktree kept because it has uncommitted changes.",
  });

  const cleanupGit = Effect.fn("StorageCleanup.cleanupGit")(function* (
    cwd: string,
    args: string[],
    command: string,
  ) {
    const result = yield* git.execute({
      operation: "StorageCleanup.cleanupGit",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0)
      return yield* new GitCommandError({
        operation: "StorageCleanup.cleanupGit",
        command,
        cwd,
        detail: result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      });
  });

  interface SweepContext {
    readonly mode: StorageCleanupMode;
    readonly now: number;
    readonly settings: ServerSettings;
    readonly roots: ReadonlyArray<string>;
    /** Per-thread statuses this pass decided; threads left out are cleared. */
    readonly statuses: Map<string, Status>;
    /** Threads whose status this pass could not evaluate, so it stays as it was. */
    readonly untouched: Set<string>;
    readonly entries: StorageCleanupReportEntry[];
    readonly defaultBranches: Map<string, string | null>;
    readonly refreshedDefaultRefs: Set<string>;
  }

  /** Decides whether a Git-based rule makes this worktree due, or why it does not. */
  const gitRuleDue = Effect.fn("StorageCleanup.gitRuleDue")(function* (
    checkout: string,
    branch: string,
    workspaceRoot: string,
    rules: WorktreeCleanupRules,
    context: SweepContext,
  ) {
    const head = yield* git.resolveCommit({ cwd: checkout, revision: "HEAD" });
    const repositoryCwd = path.resolve(workspaceRoot);
    const remotes = yield* git.execute({
      operation: "StorageCleanup.listRemotes",
      cwd: repositoryCwd,
      args: ["remote"],
    });
    const remote =
      remotes.stdout.trim() === "" ? null : yield* git.resolvePrimaryRemoteName(repositoryCwd);
    let defaultBranch: string | null | undefined;
    let defaultRef: string;
    if (remote === null) {
      if (!rules.worktreeUnchanged)
        return { due: false, reason: "no remote is configured for merged-worktree cleanup" };
      const projectHead = yield* git.execute({
        operation: "StorageCleanup.resolveProjectBranch",
        cwd: repositoryCwd,
        args: ["symbolic-ref", "--quiet", "HEAD"],
        allowNonZeroExit: true,
      });
      if (projectHead.exitCode !== 0)
        return { due: false, reason: "project branch is unavailable" };
      defaultRef = projectHead.stdout.trim();
      defaultBranch = defaultRef.slice("refs/heads/".length);
    } else {
      const key = `${repositoryCwd}\0${remote}`;
      defaultBranch = context.defaultBranches.get(key);
      if (defaultBranch === undefined) {
        defaultBranch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
        // Without a local HEAD ref only the remote can name its default; a conventional
        // name may be a feature branch.
        if (defaultBranch === null) {
          defaultBranch = yield* git
            .execute({
              operation: "StorageCleanup.resolveDefaultBranch",
              cwd: repositoryCwd,
              args: ["ls-remote", "--symref", "--", remote, "HEAD"],
              timeoutMs: 20_000,
            })
            .pipe(
              Effect.map(
                (result) => /^ref: refs\/heads\/(.+)\tHEAD\r?$/m.exec(result.stdout)?.[1] ?? null,
              ),
              Effect.orElseSucceed(() => null),
            );
        }
        context.defaultBranches.set(key, defaultBranch);
      }
      if (defaultBranch === null) return { due: false, reason: "default branch is unavailable" };
      defaultRef = `refs/remotes/${remote}/${defaultBranch}`;
      const refreshKey = `${repositoryCwd}\0${defaultRef}`;
      if (!context.refreshedDefaultRefs.has(refreshKey)) {
        yield* git.fetchRemoteTrackingBranch({
          cwd: repositoryCwd,
          remoteName: remote,
          remoteBranch: defaultBranch,
        });
        context.refreshedDefaultRefs.add(refreshKey);
      }
    }
    const base = yield* git.resolveCommit({ cwd: checkout, revision: defaultRef });
    const ancestor = yield* git.execute({
      operation: "StorageCleanup.integratedBranch",
      cwd: checkout,
      args: ["merge-base", "--is-ancestor", head.commitSha, base.commitSha],
      allowNonZeroExit: true,
    });
    const integrated = ancestor.exitCode === 0;
    if (integrated && rules.worktreeUnchanged)
      return {
        due: true,
        reason:
          remote === null
            ? "no commits beyond the project branch"
            : "no commits beyond the default branch",
      };
    if (remote !== null && rules.worktreeOnMerge) {
      const pullRequest = yield* manager.branchPullRequest(
        { cwd: checkout, branch },
        { refresh: true },
      );
      const onRemote = yield* git.execute({
        operation: "StorageCleanup.headOnRemote",
        cwd: checkout,
        args: ["for-each-ref", "--count=1", "--contains", head.commitSha, "refs/remotes"],
      });
      if (
        storageCleanupPullRequestMerged(pullRequest, {
          branch,
          defaultBranch,
          integrated,
          headOnRemote: onRemote.stdout.trim() !== "",
        })
      )
        return { due: true, reason: "pull request was merged" };
    }
    return {
      due: false,
      reason:
        remote === null
          ? "has commits beyond the project branch"
          : rules.worktreeOnMerge
            ? "not merged"
            : "has commits beyond the default branch",
    };
  });

  const clean = Effect.fn("StorageCleanup.clean")(function* (
    checkout: string,
    initial: Thread[],
    context: SweepContext,
  ) {
    // Read per checkout: a full pass fetches and refreshes pull requests, which can take minutes,
    // and the active-work guard needs a current clock.
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (!(yield* fs.exists(checkout))) return;
    const realCheckout = yield* fs.realPath(checkout);
    if (realCheckout !== checkout || !context.roots.some((root) => inside(root, checkout))) return;
    if ((yield* fs.stat(path.join(checkout, ".git"))).type !== "File") return;
    const initialSnapshot = yield* readSnapshot;
    const project = initialSnapshot.projects.find((entry) => entry.id === initial[0]!.projectId);
    if (!project || initial.some((thread) => thread.projectId !== project.id)) return;
    for (const entry of initialSnapshot.projects) {
      if (atCheckout(path.resolve(entry.workspaceRoot), checkout)) return;
    }
    const rules = resolveWorktreeCleanup(context.settings, project.id);
    if (!worktreeCleanupEnabled(rules)) return;
    const owner = initial.find((thread) => thread.lineage.sideChat !== true) ?? initial[0]!;
    const entry: StorageCleanupReportEntry = {
      kind: "worktree",
      outcome: "kept",
      reason: "",
      path: checkout,
      projectPath: project.workspaceRoot,
      threadId: owner.id,
      threadTitle: owner.title,
      bytes: null,
      files: null,
    };
    const keep = (reason: string) => {
      context.entries.push({ ...entry, reason: sentence(reason) });
    };
    const local = yield* git.statusDetailsLocal(checkout);
    // A side chat keeps the branch it was opened on; the parent's branch is the one that counts.
    const branchMatches = (thread: Thread) =>
      thread.lineage.sideChat === true || thread.branch === local.branch;
    if (
      !local.isRepo ||
      local.branch === null ||
      initial.some(
        (thread) => (!thread.branch && thread.lineage.sideChat !== true) || !branchMatches(thread),
      )
    )
      return keep("repository or branch changed");
    const branch = local.branch;

    const settled = settledIn(initialSnapshot.threads);
    const allSettled = initial.every(settled);
    const activityAt = Math.max(...initial.map(storageCleanupActivityAt));
    const settledSince = allSettled
      ? Math.max(
          activityAt,
          ...initial.map((thread) => settledAtIn(initialSnapshot.threads, thread, now) ?? now),
        )
      : null;
    const settledDue =
      rules.worktreeSettledAfterDays !== null &&
      settledSince !== null &&
      // Zero days means at settlement, whatever the clocks say.
      (rules.worktreeSettledAfterDays === 0 ||
        now - settledSince >= rules.worktreeSettledAfterDays * DAY_MS);
    const inactiveDue =
      rules.worktreeAfterDays !== null && now - activityAt >= rules.worktreeAfterDays * DAY_MS;
    // Settled cleanup speaks to the settled threads; other rules to every thread here.
    let trigger: "settled" | "other" = settledDue ? "settled" : "other";
    let removalReason = settledDue
      ? rules.worktreeSettledAfterDays === 0
        ? "thread settled"
        : `settled for ${Math.floor((now - settledSince!) / DAY_MS)} days`
      : `inactive for ${Math.floor((now - activityAt) / DAY_MS)} days`;
    // Status lines explain cleanup to settled threads only; an active thread is never told its
    // worktree is about to go or was kept.
    const notice = (state: Status["state"], reason: string) => {
      for (const thread of initial) {
        if (!settled(thread)) continue;
        context.statuses.set(thread.id, { state, reason });
      }
    };
    const waitingForWork = () =>
      notice("pending", "Worktree cleanup is waiting for other work using this checkout.");

    if (!settledDue && !inactiveDue) {
      const notDue =
        rules.worktreeAfterDays !== null
          ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} of ${rules.worktreeAfterDays} days`
          : rules.worktreeSettledAfterDays !== null
            ? settledSince === null
              ? "not settled"
              : `settled for ${Math.floor((now - settledSince) / DAY_MS)} of ${rules.worktreeSettledAfterDays} days`
            : "no time-based rules apply";
      // Settled threads sharing a checkout with active work explain why it stays.
      if (rules.worktreeSettledAfterDays !== null && !allSettled && initial.some(settled)) {
        trigger = "settled";
        waitingForWork();
      }
      // A worktree is unchanged before its first commit, so only finished threads qualify.
      const gitRules = allSettled ? rules : { ...rules, worktreeUnchanged: false };
      if (!gitRules.worktreeOnMerge && !gitRules.worktreeUnchanged) return keep(notDue);
      if (context.mode === "quick") {
        // Git-based rules run hourly; leave whatever that pass decided.
        for (const thread of initial) context.untouched.add(thread.id);
        return;
      }
      if (initial.some((thread) => worktreeHasActiveThread(thread, now)))
        return keep("thread is running or has pending work");
      const changes = yield* localChangesReason(checkout, rules.worktreeKeepWhen);
      if (changes !== null) return keep(changes);
      const decision = yield* gitRuleDue(
        checkout,
        branch,
        project.workspaceRoot,
        gitRules,
        context,
      );
      if (!decision.due) return keep(decision.reason);
      removalReason = decision.reason;
    }

    const currentGroup = Effect.gen(function* () {
      const snapshot = yield* readSnapshot;
      return {
        threads: snapshot.threads,
        group: snapshot.threads.filter(
          (thread) => thread.worktreePath != null && path.resolve(thread.worktreePath) === checkout,
        ),
      };
    });
    const eligible = ({ threads, group }: { threads: Thread[]; group: Thread[] }) =>
      group.length === initial.length &&
      group.every(
        (thread) =>
          initial.some((original) => original.id === thread.id) &&
          (trigger !== "settled" || settledIn(threads)(thread)) &&
          !worktreeHasActiveThread(thread, now) &&
          thread.pinnedAt == null &&
          (thread.snoozedUntil == null || DateTime.toEpochMillis(thread.snoozedUntil) <= now) &&
          branchMatches(thread),
      );
    if (!eligible(yield* currentGroup)) {
      waitingForWork();
      return keep("thread is running, pinned, snoozed or has pending work");
    }
    const changes = yield* localChangesReason(checkout, rules.worktreeKeepWhen);
    if (changes !== null) {
      for (const thread of initial) {
        if (!settled(thread)) continue;
        context.statuses.set(thread.id, retainedStatus(changes));
      }
      return keep(changes);
    }
    if (
      checkoutTerminals(checkout).some(
        (terminal) =>
          terminal.hasRunningSubprocess ||
          terminal.status === "starting" ||
          settleActionStarting(terminal, now),
      )
    ) {
      notice("pending", "Worktree cleanup is waiting for a terminal job to finish.");
      return keep("open terminal");
    }

    const workspaceEffectsPending = outbox.hasPendingWorkspaceEffects(
      initial.map((thread) => thread.id),
    );
    if (yield* workspaceEffectsPending) {
      notice("pending", "Worktree cleanup is waiting for checkpoint work to finish.");
      return keep("checkpoint work is pending");
    }
    const atResidency = (
      session: (typeof providers.residencies extends Effect.Effect<infer A> ? A : never)[number],
    ) =>
      session.threadIds.some((id) => initial.some((thread) => thread.id === id)) ||
      (session.cwd != null && atCheckout(session.cwd, checkout));
    for (const session of (yield* providers.residencies).filter(atResidency)) {
      if (
        session.closing ||
        session.busy ||
        session.threadIds.some((id) => !initial.some((thread) => thread.id === id))
      ) {
        notice("pending", "Worktree cleanup is waiting for another agent using this checkout.");
        return keep("provider session is still open");
      }
      yield* providers.close(session.providerSessionId);
    }
    for (const terminal of checkoutTerminals(checkout)) {
      if (terminal.hasRunningSubprocess || settleActionStarting(terminal, now))
        return keep("open terminal");
      yield* terminals.close({ threadId: terminal.threadId, terminalId: terminal.terminalId });
    }
    // Settlement, preferences and files may change while provider shutdown is in progress.
    const latestRules = resolveWorktreeCleanup(yield* settingsService.getSettings, project.id);
    if (!sameWorktreeRules(latestRules, rules)) return keep("settings changed since check");
    if (!eligible(yield* currentGroup))
      return keep("thread activity or shared worktree changed since check");
    if (
      (yield* workspaceEffectsPending) ||
      (yield* providers.residencies).some(atResidency) ||
      checkoutTerminals(checkout).length > 0
    )
      return keep("work started on this worktree since check");
    const finalStatus = yield* git.statusDetailsLocal(checkout);
    const finalChanges =
      finalStatus.branch !== local.branch
        ? "repository or branch changed since check"
        : yield* localChangesReason(checkout, rules.worktreeKeepWhen);
    if (finalChanges !== null) {
      notice("retained", "Worktree kept because its local files changed during cleanup.");
      return keep(finalChanges);
    }
    // Clean only untracked files; Git's non-forced removal still refuses tracked edits.
    if (rules.worktreeKeepWhen === "tracked-changes")
      yield* cleanupGit(checkout, ["clean", "-ffdx"], "git clean");
    yield* git.removeWorktree({ cwd: project.workspaceRoot, path: checkout, force: false });
    yield* manager.invalidateStatus(project.workspaceRoot);
    context.entries.push({ ...entry, outcome: "removed", reason: sentence(removalReason) });
    // The thread keeps its branch and path so a later turn can recreate the checkout.
    yield* Effect.logInfo("storage cleanup removed worktree", { checkout });
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    context: Omit<SweepContext, "roots">,
  ) {
    const snapshot = yield* readSnapshot;
    const roots: string[] = [];
    for (const directory of isWorktreeDevHome
      ? [config.worktreesDir]
      : managedWorktreesDirectories(context.settings, config.worktreesDir, path)) {
      const root = yield* fs.exists(directory).pipe(
        Effect.flatMap((exists) => (exists ? fs.realPath(directory) : Effect.succeed(null))),
        Effect.orElseSucceed(() => null),
      );
      if (root !== null && !isFilesystemRoot(root, path)) roots.push(root);
    }
    const full = { ...context, roots };
    const groups = new Map<string, Thread[]>();
    for (const thread of snapshot.threads) {
      // A side chat keeps the branch label it was opened with, which may be none.
      if (!thread.worktreePath || (!thread.branch && thread.lineage.sideChat !== true)) continue;
      const checkout = path.resolve(thread.worktreePath);
      if (!roots.some((root) => inside(root, checkout))) continue;
      const group = groups.get(checkout) ?? [];
      group.push(thread);
      groups.set(checkout, group);
    }
    for (const [checkout, group] of groups) {
      yield* withWorktreeLease(checkout, clean(checkout, group, full)).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            for (const thread of group.filter(settledIn(snapshot.threads)))
              full.statuses.set(thread.id, {
                state: "retained",
                reason: "Worktree cleanup could not finish. It will retry automatically.",
              });
            const owner = group.find((thread) => thread.lineage.sideChat !== true) ?? group[0]!;
            full.entries.push({
              kind: "worktree",
              outcome: "failed",
              reason: cleanupFailureReason(error),
              path: checkout,
              projectPath:
                snapshot.projects.find((project) => project.id === owner.projectId)
                  ?.workspaceRoot ?? null,
              threadId: owner.id,
              threadTitle: owner.title,
              bytes: null,
              files: null,
            });
            yield* Effect.logWarning("worktree cleanup failed", { checkout, error });
          }),
        ),
      );
    }
    // Publish only changed statuses; threads this pass did not reach lose stale ones.
    const latest = yield* readSnapshot;
    for (const thread of latest.threads) {
      if (full.untouched.has(thread.id) && !full.statuses.has(thread.id)) continue;
      yield* report(thread, full.statuses.get(thread.id) ?? null);
    }
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number,
    now: number,
    rotatedLogs: boolean,
    removed: { files: number; bytes: number },
  ) {
    if (!(yield* fs.exists(root))) return removed;
    // A symlinked parent (a linked state home) is fine; a symlinked folder is not.
    const realRoot = yield* fs.realPath(root);
    const realParent = yield* fs.realPath(path.dirname(root));
    if (realRoot !== path.join(realParent, path.basename(root))) return removed;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            // Stop if the retention changed mid-pass; the next pass uses the new value.
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
            removed.files++;
            removed.bytes += Number(stat.size);
          }
        }
      }
    });
    yield* visit(realRoot);
    return removed;
  });

  const reportRef = yield* SubscriptionRef.make<StorageCleanupReport | null>(null);
  const sweep = Effect.fn("StorageCleanup.sweep")(function* (mode: StorageCleanupMode) {
    const startedAt = yield* DateTime.now;
    const now = DateTime.toEpochMillis(startedAt);
    const entries: StorageCleanupReportEntry[] = [];
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* cleanWorktrees({
      mode,
      now,
      settings,
      statuses: new Map(),
      untouched: new Set(),
      entries,
      defaultBranches: new Map(),
      refreshedDefaultRefs: new Set(),
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          entries.push({
            kind: "worktree",
            outcome: "failed",
            reason: cleanupFailureReason(error),
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: null,
            files: null,
          });
          yield* Effect.logWarning("worktree cleanup sweep failed", { error });
        }),
      ),
    );
    if (mode !== "quick") {
      for (const category of [
        {
          kind: "browser-artifacts" as const,
          root: config.browserArtifactsDir,
          days: settings.storageCleanup.browserArtifactsAfterDays,
          label: "browser artifacts",
        },
        {
          kind: "logs" as const,
          root: config.logsDir,
          days: settings.storageCleanup.logsAfterDays,
          label: "rotated logs",
        },
      ]) {
        if (category.days === null) continue;
        const removed = { files: 0, bytes: 0 };
        yield* cleanFiles(
          category.root,
          category.days,
          now,
          category.kind === "logs",
          removed,
        ).pipe(
          Effect.map(({ files, bytes }) =>
            entries.push({
              kind: category.kind,
              outcome: files > 0 ? "removed" : "kept",
              reason: files === 0 ? "No expired files" : `Removed ${files} ${category.label}`,
              path: null,
              projectPath: null,
              threadId: null,
              threadTitle: null,
              bytes: files > 0 ? bytes : null,
              files: files > 0 ? files : null,
            }),
          ),
          Effect.catch((error) =>
            Effect.gen(function* () {
              entries.push({
                kind: category.kind,
                outcome: "failed",
                reason: cleanupFailureReason(error),
                path: null,
                projectPath: null,
                threadId: null,
                threadTitle: null,
                bytes: removed.files > 0 ? removed.bytes : null,
                files: removed.files > 0 ? removed.files : null,
              });
              yield* Effect.logWarning("storage file cleanup failed", {
                kind: category.kind,
                error,
              });
            }),
          ),
        );
      }
    }
    const counts = { removed: 0, kept: 0, failed: 0 };
    let bytesFreed = 0;
    for (const entry of entries) {
      counts[entry.outcome]++;
      if (entry.outcome !== "kept") bytesFreed += entry.bytes ?? 0;
    }
    const priority = (entry: StorageCleanupReportEntry) =>
      entry.outcome === "failed" ? 0 : entry.outcome === "removed" ? 1 : 2;
    const result: StorageCleanupReport = {
      trigger: mode === "manual" ? "manual" : "automatic",
      startedAt: DateTime.formatIso(startedAt),
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      entries: entries.sort((a, b) => priority(a) - priority(b)).slice(0, REPORT_ENTRY_LIMIT),
      counts,
      bytesFreed,
      omittedCount: Math.max(0, entries.length - REPORT_ENTRY_LIMIT),
    };
    // Quick passes only cover time-based worktree rules, so they don't replace the full report.
    if (mode !== "quick") yield* SubscriptionRef.set(reportRef, result);
    return result;
  });

  type Job = {
    readonly mode: StorageCleanupMode;
    readonly completion?: Deferred.Deferred<StorageCleanupReport, ServerSettingsError>;
  };
  const queued = yield* Ref.make<ReadonlySet<StorageCleanupMode>>(new Set());
  const worker = yield* makeDrainableWorker((job: Job) =>
    (job.completion === undefined
      ? Ref.update(queued, (modes) => new Set([...modes].filter((mode) => mode !== job.mode)))
      : Effect.void
    ).pipe(
      Effect.andThen(sweep(job.mode)),
      Effect.exit,
      Effect.flatMap((exit) =>
        job.completion === undefined
          ? exit.pipe(
              Effect.asVoid,
              Effect.catchCause((cause) => Effect.logWarning("storage cleanup failed", { cause })),
            )
          : Deferred.done(job.completion, exit).pipe(Effect.asVoid),
      ),
    ),
  );
  /** Coalesces automatic passes: one queued pass of each mode covers every request. */
  const request = (mode: Exclude<StorageCleanupMode, "manual">) =>
    Ref.modify(queued, (modes) =>
      modes.has(mode) ? [true, modes] : [false, new Set([...modes, mode])],
    ).pipe(Effect.flatMap((already) => (already ? Effect.void : worker.enqueue({ mode }))));
  const runNow = Effect.gen(function* () {
    const completion = yield* Deferred.make<StorageCleanupReport, ServerSettingsError>();
    yield* worker.enqueue({ mode: "manual", completion });
    return yield* Deferred.await(completion);
  });

  const start = Effect.fn("StorageCleanup.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals)
            liveTerminals.set(`${terminal.threadId}:${terminal.terminalId}`, terminal);
        } else if (event.type === "upsert")
          liveTerminals.set(
            `${event.terminal.threadId}:${event.terminal.terminalId}`,
            event.terminal,
          );
        else liveTerminals.delete(`${event.threadId}:${event.terminalId}`);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    const changes = yield* settingsService.subscribeChanges;
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          Equal.equals(settings.projectSettingsOverrides, lastSettings.projectSettingsOverrides) &&
          settings.worktreesDirectory === lastSettings.worktreesDirectory
        )
          return Effect.void;
        lastSettings = settings;
        return request("quick");
      }),
    );
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "thread.settled" ||
        event.type === "thread.unsettled" ||
        event.type === "thread.archived" ||
        event.type === "thread.unarchived"
          ? request("quick")
          : Effect.void,
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("storage cleanup subscription failed", { error }),
        ),
      ),
    );
    yield* forkParked(
      request("quick").pipe(
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("1 minute")),
      ),
    );
    yield* forkParked(
      request("automatic").pipe(
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("1 hour")),
      ),
    );
  });

  return StorageCleanup.of({
    start,
    sweep: (mode) => sweep(mode),
    runNow,
    latestReport: SubscriptionRef.get(reportRef),
    reports: SubscriptionRef.changes(reportRef),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(StorageCleanup, make);
