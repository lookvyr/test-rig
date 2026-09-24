import * as NodeAssert from "node:assert/strict";
import * as NodeOS from "node:os";

import * as Console from "effect/Console";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as CodexClient from "../../src/client.ts";
import type { ServerNotificationParamsByMethod } from "../../src/_generated/meta.gen.ts";

const runTurns = process.argv.includes("--run-turns");

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-codex-probe-" });
  const codexHome = path.join(directory, "codex");
  const workspace = path.join(directory, "workspace");
  yield* fs.makeDirectory(codexHome, { mode: 0o700 });
  yield* fs.makeDirectory(workspace);
  const auth = path.join(
    process.env.CODEX_HOME ?? path.join(NodeOS.homedir(), ".codex"),
    "auth.json",
  );
  if (yield* fs.exists(auth)) yield* fs.copyFile(auth, path.join(codexHome, "auth.json"));
  // Keep credentials and session writes in the disposable home; do not load user integrations.
  yield* fs.writeFileString(
    path.join(codexHome, "config.toml"),
    'cli_auth_credentials_store = "file"\n',
  );
  yield* fs.writeFileString(path.join(workspace, "probe.txt"), "codex-compatibility-probe\n");

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const binary = process.env.CODEX_BIN ?? "codex";
  const commandOptions = { cwd: workspace, env: { CODEX_HOME: codexHome }, extendEnv: true };
  const version = yield* spawner.string(ChildProcess.make(binary, ["--version"], commandOptions));
  yield* Console.log(`CLI: ${version.trim()}`);
  const handle = yield* spawner.spawn(ChildProcess.make(binary, ["app-server"], commandOptions));

  yield* Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    const initialized = yield* client.request("initialize", {
      clientInfo: {
        name: "test-rig-compatibility-probe",
        title: "Test Rig probe",
        version: "0.0.0",
      },
      capabilities: { experimentalApi: true, optOutNotificationMethods: null },
    });
    const actualHome = yield* fs.realPath(initialized.codexHome);
    const expectedHome = yield* fs.realPath(codexHome);
    yield* Effect.sync(() => NodeAssert.equal(actualHome, expectedHome));
    yield* client.notify("initialized", undefined);
    yield* Console.log("PASS initialize (isolated Codex home)");
    const models = yield* client.request("model/list", {});
    yield* Effect.sync(() =>
      NodeAssert.ok(models.data.length > 0, "model/list returned no models"),
    );
    yield* Console.log(`PASS model/list (${models.data.length} models)`);
    if (!runTurns) {
      yield* Console.log(
        "SKIP model turns/history/revert/resume: pass --run-turns to use model credits.",
      );
      return;
    }

    const { thread } = yield* client.request("thread/start", {
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: "read-only",
      historyMode: "paginated",
      ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}),
    });
    yield* Effect.sync(() => NodeAssert.equal(thread.historyMode, "paginated"));
    yield* Console.log("PASS thread/start (paginated history)");

    type CompletedTurn = ServerNotificationParamsByMethod["turn/completed"]["turn"];
    let completion = yield* Deferred.make<CompletedTurn>();
    let textDeltas = 0;
    let commands = 0;
    yield* client.handleServerNotification("turn/completed", ({ threadId, turn }) =>
      threadId === thread.id ? Deferred.succeed(completion, turn).pipe(Effect.asVoid) : Effect.void,
    );
    yield* client.handleServerNotification("item/agentMessage/delta", ({ threadId }) =>
      Effect.sync(() => {
        if (threadId === thread.id) textDeltas++;
      }),
    );
    yield* client.handleServerNotification("item/completed", ({ threadId, item }) =>
      Effect.sync(() => {
        if (
          threadId === thread.id &&
          item.type === "commandExecution" &&
          item.status === "completed"
        )
          commands++;
      }),
    );

    const turnIds: string[] = [];
    for (const prompt of [
      "Run the shell command `cat probe.txt` exactly once, then reply with the contents. Do not modify files or run any other tools.",
      "Reply with exactly: second turn complete. Do not use tools.",
    ]) {
      completion = yield* Deferred.make<CompletedTurn>();
      const started = yield* client.request("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text: prompt, text_elements: [] }],
      });
      const completed = yield* Deferred.await(completion).pipe(Effect.timeout("90 seconds"));
      yield* Effect.sync(() => {
        NodeAssert.equal(completed.id, started.turn.id);
        NodeAssert.equal(completed.status, "completed", "Model turn failed or was interrupted");
      });
      turnIds.push(completed.id);
      yield* Console.log(`PASS turn ${turnIds.length}`);
    }
    yield* Effect.sync(() => {
      NodeAssert.ok(textDeltas > 0, "No agent text deltas received");
      NodeAssert.ok(commands > 0, "Model did not complete the requested shell command");
    });
    yield* Console.log("PASS text and command notifications");

    const firstPage = yield* client.request("thread/turns/list", {
      threadId: thread.id,
      limit: 1,
      sortDirection: "asc",
      itemsView: "full",
    });
    yield* Effect.sync(() => {
      NodeAssert.deepEqual(
        firstPage.data.map((turn) => turn.id),
        [turnIds[0]],
      );
      NodeAssert.ok(firstPage.nextCursor, "Missing second history page");
      NodeAssert.ok(firstPage.data[0]?.items.some((item) => item.type === "commandExecution"));
    });
    const secondPage = yield* client.request("thread/turns/list", {
      threadId: thread.id,
      limit: 1,
      sortDirection: "asc",
      itemsView: "full",
      cursor: firstPage.nextCursor!,
    });
    yield* Effect.sync(() =>
      NodeAssert.deepEqual(
        secondPage.data.map((turn) => turn.id),
        [turnIds[1]],
      ),
    );
    yield* Console.log("PASS paginated history (two pages and command item)");

    yield* client.request("thread/revert", { threadId: thread.id, beforeTurnId: turnIds[1]! });
    yield* client.request("thread/unsubscribe", { threadId: thread.id });
    const resumed = yield* client.request("thread/resume", {
      threadId: thread.id,
      excludeTurns: true,
    });
    yield* Effect.sync(() => NodeAssert.equal(resumed.thread.id, thread.id));
    const retained = yield* client.request("thread/turns/list", {
      threadId: thread.id,
      itemsView: "full",
      sortDirection: "asc",
    });
    yield* Effect.sync(() =>
      NodeAssert.deepEqual(
        retained.data.map((turn) => turn.id),
        [turnIds[0]],
      ),
    );
    yield* Console.log("PASS revert and resume (only first turn retained)");
  }).pipe(Effect.provide(CodexClient.layerChildProcess(handle)));
});

program.pipe(
  Effect.timeout(runTurns ? "4 minutes" : "30 seconds"),
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
