import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
import {
  CommandId,
  EventId,
  type OrchestrationThreadShell,
  type TerminalSummary,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { GitManager } from "../git/GitManager.ts";
import { forkParked } from "../serverActivation.ts";
import { WorktreeCleanupState } from "./WorktreeCleanupState.ts";
import { withWorktreeLease } from "./worktreeLifecycle.ts";

type Thread = OrchestrationThreadShell;
type Status = NonNullable<Thread["worktreeCleanup"]>;

/** A settlement never overrides active work, including provider background tasks. */
export function worktreeHasActiveThread(thread: Thread, now: number): boolean {
  const messageAt =
    thread.latestUserMessageAt == null ? -Infinity : Date.parse(thread.latestUserMessageAt);
  const turnAt = Math.max(
    ...[
      thread.latestTurn?.requestedAt,
      thread.latestTurn?.startedAt,
      thread.latestTurn?.completedAt,
    ].map((at) => (at == null ? -Infinity : Date.parse(at))),
  );
  const queued =
    thread.session?.status !== "error" &&
    messageAt > turnAt &&
    Math.abs(now - messageAt) <= 120_000;
  return (
    queued ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.backgroundLiveness != null ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    thread.latestTurn?.state === "running"
  );
}

export function hasMeaningfulIgnoredFiles(output: string, truncated: boolean): boolean {
  return (
    truncated ||
    output.split("\0").some((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry))
  );
}

export class WorktreeCleanup extends Context.Service<
  WorktreeCleanup,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly sweep: Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/workspace/WorktreeCleanup") {}

export const make = Effect.gen(function* () {
  const checkpoints = yield* CheckpointReactor;
  const config = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const settings = yield* ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const providers = yield* ProviderService;
  const terminals = yield* TerminalManager;
  const git = yield* GitVcsDriver;
  const manager = yield* GitManager;
  const statuses = yield* WorktreeCleanupState;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, TerminalSummary>();
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
    const active = yield* snapshots.getShellSnapshot();
    const archived = yield* snapshots.getArchivedShellSnapshot();
    return { projects: active.projects, threads: [...active.threads, ...archived.threads] };
  });
  const report = Effect.fn("WorktreeCleanup.report")(function* (
    thread: Thread,
    status: Status | null,
  ) {
    if (!statuses.set(thread.id, status)) return;
    const now = DateTime.formatIso(yield* DateTime.now);
    // This event refreshes the existing shell subscription; the notice itself is transient.
    yield* engine.dispatch({
      type: "thread.activity.append",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      threadId: thread.id,
      activity: {
        id: EventId.make(yield* crypto.randomUUIDv4),
        kind: "worktree.cleanup",
        tone: "info",
        summary: status?.reason ?? "Worktree cleanup notice cleared",
        payload: {},
        turnId: null,
        createdAt: now,
      },
      createdAt: now,
    });
  });
  const settled = (thread: Thread) =>
    thread.settledOverride === "settled" || thread.archivedAt !== null;
  const automaticCandidate = (thread: Thread, now: number) =>
    thread.settledOverride !== "active" &&
    thread.pinnedAt == null &&
    (thread.snoozedUntil == null || Date.parse(thread.snoozedUntil) <= now) &&
    !worktreeHasActiveThread(thread, now);

  const clean = Effect.fn("WorktreeCleanup.clean")(function* (checkout: string, initial: Thread[]) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (!(yield* fs.exists(checkout))) {
      for (const thread of initial) yield* report(thread, null);
      return;
    }
    const root = yield* fs.realPath(config.worktreesDir);
    if (!inside(root, checkout) || (yield* fs.realPath(checkout)) !== checkout) return;
    if ((yield* fs.stat(path.join(checkout, ".git"))).type !== "File") return;
    const initialSnapshot = yield* readSnapshot;
    const project = initialSnapshot.projects.find((entry) => entry.id === initial[0]!.projectId);
    if (!project || initial.some((thread) => thread.projectId !== project.id)) return;
    for (const entry of initialSnapshot.projects) {
      if (atCheckout(path.resolve(entry.workspaceRoot), checkout)) return;
    }
    const local = yield* git.statusDetailsLocal(checkout);
    if (!local.isRepo || initial.some((thread) => !thread.branch || thread.branch !== local.branch))
      return;
    const notice = Effect.fn("WorktreeCleanup.notice")(function* (
      state: Status["state"],
      reason: string,
    ) {
      for (const thread of (yield* readSnapshot).threads.filter(
        (entry) => initial.some((original) => original.id === entry.id) && settled(entry),
      ))
        yield* report(thread, { state, reason });
    });
    // Retain a durable settlement before removing the checkout that supplied the PR association.
    if (initial.some((thread) => !settled(thread))) {
      if (initial.some((thread) => !settled(thread) && !automaticCandidate(thread, now))) {
        yield* notice("pending", "Worktree cleanup is waiting for other work using this checkout.");
        return;
      }
      const remote = yield* manager.remoteStatus({ cwd: checkout }, { refreshUpstream: false });
      if (remote?.pr?.state !== "merged" && remote?.pr?.state !== "closed") {
        yield* notice("pending", "Worktree cleanup is waiting for other work using this checkout.");
        return;
      }
      if (!(yield* settings.getSettings).autoRemoveSettledWorktrees) return;
      const refreshed = (yield* readSnapshot).threads.filter((thread) =>
        initial.some((entry) => entry.id === thread.id),
      );
      if (
        refreshed.length !== initial.length ||
        refreshed.some((thread) => !settled(thread) && !automaticCandidate(thread, now))
      )
        return;
      for (const thread of refreshed) {
        if (!settled(thread))
          yield* engine.dispatch({
            type: "thread.settle",
            threadId: thread.id,
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
          });
      }
    }
    const currentGroup = Effect.gen(function* () {
      const snapshot = yield* readSnapshot;
      return snapshot.threads.filter(
        (thread) => thread.worktreePath != null && path.resolve(thread.worktreePath) === checkout,
      );
    });
    const eligible = (group: Thread[]) =>
      group.length === initial.length &&
      group.every(
        (thread) =>
          initial.some((original) => original.id === thread.id) &&
          settled(thread) &&
          !worktreeHasActiveThread(thread, now) &&
          thread.pinnedAt == null &&
          thread.branch === local.branch,
      );
    if (!eligible(yield* currentGroup)) {
      yield* notice("pending", "Worktree cleanup is waiting for other work using this checkout.");
      return;
    }
    if (local.hasWorkingTreeChanges) {
      yield* notice("retained", "Worktree kept because it has uncommitted changes.");
      return;
    }
    const ignored = () =>
      git.execute({
        operation: "WorktreeCleanup.ignoredFiles",
        cwd: checkout,
        args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
        maxOutputBytes: 64 * 1024,
      });
    const ignoredFiles = yield* ignored();
    if (hasMeaningfulIgnoredFiles(ignoredFiles.stdout, ignoredFiles.stdoutTruncated)) {
      yield* notice("retained", "Worktree kept because it contains local-only files.");
      return;
    }
    if (
      checkoutTerminals(checkout).some(
        (terminal) => terminal.hasRunningSubprocess || terminal.status === "starting",
      )
    ) {
      yield* notice("pending", "Worktree cleanup is waiting for a terminal job to finish.");
      return;
    }

    for (const session of yield* providers.listSessions()) {
      if (session.status === "closed") continue;
      if (
        !initial.some((thread) => thread.id === session.threadId) &&
        (session.cwd === undefined || !atCheckout(session.cwd, checkout))
      )
        continue;
      if (!initial.some((thread) => thread.id === session.threadId)) {
        yield* notice(
          "pending",
          "Worktree cleanup is waiting for another agent using this checkout.",
        );
        return;
      }
      yield* providers.stopSession({ threadId: session.threadId });
    }
    for (const terminal of checkoutTerminals(checkout)) {
      if (terminal.hasRunningSubprocess) return;
      yield* terminals.close({ threadId: terminal.threadId, terminalId: terminal.terminalId });
    }
    // Settlement, preferences and files may change while provider shutdown is in progress.
    if (!(yield* settings.getSettings).autoRemoveSettledWorktrees || !eligible(yield* currentGroup))
      return;
    const finalStatus = yield* git.statusDetailsLocal(checkout);
    const finalIgnored = yield* ignored();
    if (
      finalStatus.hasWorkingTreeChanges ||
      finalStatus.branch !== local.branch ||
      hasMeaningfulIgnoredFiles(finalIgnored.stdout, finalIgnored.stdoutTruncated)
    ) {
      yield* notice("retained", "Worktree kept because its local files changed during cleanup.");
      return;
    }
    yield* git.removeWorktree({ cwd: project.workspaceRoot, path: checkout, force: false });
    yield* manager.invalidateStatus(project.workspaceRoot);
    for (const thread of initial) yield* report(thread, null);
  });
  const sweep = Effect.gen(function* () {
    const snapshot = yield* readSnapshot;
    const enabled = (yield* settings.getSettings).autoRemoveSettledWorktrees;
    for (const id of statuses.ids()) {
      const thread = snapshot.threads.find((entry) => entry.id === id);
      if (!thread) statuses.set(id, null);
      else if (!enabled || !settled(thread)) yield* report(thread, null);
    }
    if (!enabled) return;
    const groups = new Map<string, Thread[]>();
    for (const thread of snapshot.threads) {
      if (!thread.worktreePath || !thread.branch) continue;
      const checkout = path.resolve(thread.worktreePath);
      if (!inside(path.resolve(config.worktreesDir), checkout)) continue;
      const group = groups.get(checkout) ?? [];
      group.push(thread);
      groups.set(checkout, group);
    }
    for (const [checkout, group] of groups) {
      yield* checkpoints.drain;
      yield* withWorktreeLease(checkout, clean(checkout, group)).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            for (const thread of group.filter(settled))
              yield* report(thread, {
                state: "retained",
                reason: "Worktree cleanup could not finish. It will retry automatically.",
              });
            yield* Effect.logWarning("worktree cleanup failed", { checkout, error });
          }),
        ),
      );
    }
  }).pipe(Effect.catch((error) => Effect.logWarning("worktree cleanup sweep failed", { error })));
  const worker = yield* makeDrainableWorker(() => sweep);
  const start = Effect.fn("WorktreeCleanup.start")(function* () {
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
    const changes = yield* settings.subscribeChanges;
    yield* forkParked(Stream.runForEach(changes, () => worker.enqueue(undefined)));
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "thread.settled" ||
        event.type === "thread.unsettled" ||
        event.type === "thread.archived"
          ? worker.enqueue(undefined)
          : Effect.void,
      ),
    );
    yield* forkParked(
      worker
        .enqueue(undefined)
        .pipe(Effect.andThen(worker.drain), Effect.repeat(Schedule.spaced("1 minute"))),
    );
  });
  return { start, sweep, drain: worker.drain };
});

export const layer = Layer.effect(WorktreeCleanup, make);
