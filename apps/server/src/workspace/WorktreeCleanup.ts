import { EffectOutboxV2 } from "../orchestration-v2/EffectOutbox.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import {
  CommandId,
  type OrchestrationV2ThreadShell,
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
import { TerminalManager } from "../terminal/Manager.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { GitManager } from "../git/GitManager.ts";
import { forkParked } from "../serverActivation.ts";
import { withWorktreeLease } from "./worktreeLifecycle.ts";

type Thread = OrchestrationV2ThreadShell;
type Status = NonNullable<Thread["worktreeCleanup"]>;

/** A settlement never overrides active work, including provider background tasks. */
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

export class WorktreeCleanup extends Context.Service<
  WorktreeCleanup,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly sweep: Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/workspace/WorktreeCleanup") {}

export const make = Effect.gen(function* () {
  const outbox = yield* EffectOutboxV2;
  const config = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const settings = yield* ServerSettingsService;
  const projects = yield* ProjectStoreV2;
  const engine = yield* ThreadManagementService;
  const providers = yield* ProviderSessionManagerV2;
  const terminals = yield* TerminalManager;
  const git = yield* GitVcsDriver;
  const manager = yield* GitManager;
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
    const shell = yield* engine.getShellSnapshot();
    return {
      projects: yield* projects.listShells(),
      threads: [...shell.threads, ...shell.archivedThreads],
    };
  });
  const report = Effect.fn("WorktreeCleanup.report")(function* (
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
  const settled = (thread: Thread) =>
    thread.settledOverride === "settled" || thread.archivedAt !== null;
  const automaticCandidate = (thread: Thread, now: number) =>
    thread.settledOverride !== "active" &&
    thread.pullRequestAssociation?.mode !== "unlinked" &&
    thread.pinnedAt == null &&
    (thread.snoozedUntil == null || DateTime.toEpochMillis(thread.snoozedUntil) <= now) &&
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
      const matchesCheckoutPr = (thread: Thread) =>
        thread.pullRequestAssociation?.mode !== "linked" ||
        thread.pullRequestAssociation.reference === remote?.pr?.url;
      if (
        (remote?.pr?.state !== "merged" && remote?.pr?.state !== "closed") ||
        initial.some((thread) => !settled(thread) && !matchesCheckoutPr(thread))
      ) {
        yield* notice("pending", "Worktree cleanup is waiting for other work using this checkout.");
        return;
      }
      if (!(yield* settings.getSettings).autoRemoveSettledWorktrees) return;
      const refreshed = (yield* readSnapshot).threads.filter((thread) =>
        initial.some((entry) => entry.id === thread.id),
      );
      if (
        refreshed.length !== initial.length ||
        refreshed.some(
          (thread) =>
            !settled(thread) && (!automaticCandidate(thread, now) || !matchesCheckoutPr(thread)),
        )
      )
        return;
      for (const thread of refreshed) {
        if (!settled(thread))
          yield* engine.dispatch({
            type: "thread.auto-settle",
            snapshotAt: thread.updatedAt,
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
          (thread.snoozedUntil == null || DateTime.toEpochMillis(thread.snoozedUntil) <= now) &&
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
    if (
      checkoutTerminals(checkout).some(
        (terminal) => terminal.hasRunningSubprocess || terminal.status === "starting",
      )
    ) {
      yield* notice("pending", "Worktree cleanup is waiting for a terminal job to finish.");
      return;
    }

    const workspaceEffectsPending = outbox.hasPendingWorkspaceEffects(
      initial.map((thread) => thread.id),
    );
    if (yield* workspaceEffectsPending) {
      yield* notice("pending", "Worktree cleanup is waiting for checkpoint work to finish.");
      return;
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
        yield* notice(
          "pending",
          "Worktree cleanup is waiting for another agent using this checkout.",
        );
        return;
      }
      yield* providers.close(session.providerSessionId);
    }
    for (const terminal of checkoutTerminals(checkout)) {
      if (terminal.hasRunningSubprocess) return;
      yield* terminals.close({ threadId: terminal.threadId, terminalId: terminal.terminalId });
    }
    // Settlement, preferences and files may change while provider shutdown is in progress.
    if (!(yield* settings.getSettings).autoRemoveSettledWorktrees || !eligible(yield* currentGroup))
      return;
    if (
      (yield* workspaceEffectsPending) ||
      (yield* providers.residencies).some(atResidency) ||
      checkoutTerminals(checkout).length > 0
    )
      return;
    const finalStatus = yield* git.statusDetailsLocal(checkout);
    if (finalStatus.hasWorkingTreeChanges || finalStatus.branch !== local.branch) {
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
    for (const thread of snapshot.threads) {
      if (thread.worktreeCleanup != null && (!enabled || !settled(thread)))
        yield* report(thread, null);
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
        event.type === "thread.archived" ||
        event.type === "thread.unarchived"
          ? worker.enqueue(undefined)
          : Effect.void,
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("worktree cleanup subscription failed", { error }),
        ),
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
