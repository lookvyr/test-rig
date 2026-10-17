import { assert, it, vi } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TerminalManager from "../terminal/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("resolves setup scripts through the standalone project service", () => {
  const open = vi.fn((input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId,
      cwd: input.cwd,
      worktreePath: input.worktreePath ?? null,
      status: "running" as const,
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      label: "Shell",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const listeners: Array<Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]> =
    [];
  const unsubscribe = vi.fn();
  const subscribe: TerminalManager.TerminalManager["Service"]["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener);
      return unsubscribe;
    });
  const projectId = ProjectId.make("project:setup-runner-v2");
  const project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "vp install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write, subscribe }),
        ServerSettings.layerTest(),
      ),
    ),
  );

  return Effect.gen(function* () {
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.deepEqual(result, {
      status: "started",
      async: true,
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "vp install",
      terminalId: "setup-setup",
      cwd: "/repo-worktree",
    });
    assert.equal(open.mock.calls[0]?.[0].cwd, "/repo-worktree");
    assert.deepEqual(open.mock.calls[0]?.[0].env, {
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo-worktree",
      COLORTERM: "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    });
    assert.equal(write.mock.calls[0]?.[0].data, "vp install\r");

    // Handoff supplies the project directly; saved project overrides must
    // still win over that snapshot and the environment defaults.
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({
      defaultProjectScripts: [{ ...project.scripts[0]!, command: "global-setup" }],
      projectSettingsOverrides: {
        [projectId]: {
          defaultProjectScripts: [{ ...project.scripts[0]!, command: "project-setup" }],
        },
      },
    });
    const handoffSetup = yield* runner.runForThread({
      threadId: "thread-handoff",
      project,
      projectCwd: "/repo",
      worktreePath: "/handoff-worktree",
    });
    assert.equal(handoffSetup.status, "started");
    assert.equal(open.mock.calls[1]?.[0].cwd, "/handoff-worktree");
    assert.equal(open.mock.calls[1]?.[0].env?.T3CODE_WORKTREE_PATH, "/handoff-worktree");
    assert.equal(write.mock.calls[1]?.[0].data, "project-setup\r");
    const lines: string[] = [];
    const observed = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      observeCompletion: {
        onOutputLine: (line) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      },
    });
    assert.equal(observed.status, "started");
    const listener = listeners[0]!;
    yield* listener({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: "Downloading 10%\rDownloading 20%\r\nDone\n",
    });
    assert.deepEqual(lines, ["Downloading 10%", "Downloading 20%", "Done"]);
    yield* listener({ type: "closed", threadId: "thread-1", terminalId: "setup-setup" });
    // The caller may never await completion (for example, Stop won the release race).
    assert.equal(unsubscribe.mock.calls.length, 1);
  }).pipe(Effect.provide(layer));
});

it.effect("unsubscribes completion output when Stop interrupts the initial command write", () =>
  Effect.gen(function* () {
    const writing = yield* Deferred.make<void>();
    const unsubscribe = vi.fn();
    const layer = ProjectSetupScriptRunner.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettings.layerTest(),
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.mock(TerminalManager.TerminalManager)({
            open: (input) =>
              Effect.succeed({
                threadId: input.threadId,
                terminalId: input.terminalId,
                cwd: input.cwd,
                worktreePath: input.worktreePath ?? null,
                status: "running",
                pid: 123,
                history: "",
                exitCode: null,
                exitSignal: null,
                label: "Shell",
                updatedAt: "2026-10-17T00:00:00.000Z",
              }),
            subscribe: () => Effect.succeed(unsubscribe),
            write: () => Deferred.succeed(writing, undefined).pipe(Effect.andThen(Effect.never)),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const fiber = yield* runner
        .runForThread({
          threadId: "preparing-child",
          worktreePath: "/disposable/child",
          preferredTerminalId: "owned-setup",
          project: {
            id: ProjectId.make("fixture"),
            workspaceRoot: "/disposable/parent",
            scripts: [
              {
                id: "setup",
                name: "Setup",
                command: "install",
                icon: "configure",
                runOnWorktreeCreate: true,
              },
            ],
          },
          observeCompletion: {},
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(writing);
      yield* Fiber.interrupt(fiber);
      assert.equal(unsubscribe.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  }),
);
