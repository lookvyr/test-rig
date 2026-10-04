// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentProjectsHttpApi, EventId, ThreadId } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { cli } from "./bin.ts";
import * as ServerConfig from "./config.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as EventSink from "./orchestration-v2/EventSink.ts";
import {
  ProjectServiceLayerLive,
  OrchestrationV2EventSinkLayerLive,
} from "./orchestration-v2/runtimeLayer.ts";
import { v2Projection } from "./orchestration-v2/testkit/fixtures.ts";
import * as ProjectEnrichmentService from "./project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "./project/T3ProjectFileLoader.ts";
import { projectHttpApiLayer } from "./project/http.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { environmentAuthenticatedAuthLayer } from "./auth/http.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
class ProjectCliHttpApi extends HttpApi.make("environment").add(EnvironmentProjectsHttpApi) {}

const runCli = (args: ReadonlyArray<string>, command = cli) =>
  Command.runWith(command, { version: "0.0.0" })(args);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const makeCliTestServerConfig = (baseDir: string) =>
  Effect.gen(function* () {
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      mode: "web",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      devAllowedOrigins: [],
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
    } satisfies ServerConfig.ServerConfig["Service"];
  });

const makeProjectPersistenceLayer = (config: ServerConfig.ServerConfig["Service"]) =>
  Layer.mergeAll(
    ProjectServiceLayerLive,
    ProjectStore.layer,
    ProjectionStore.layer,
    OrchestrationV2EventSinkLayerLive,
  ).pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(ProjectFaviconResolver.layer.pipe(Layer.provide(T3ProjectFileLoader.layer))),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceLayerLive),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ServerConfig.layer(config)),
  );

const readPersistedSnapshot = (baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    return yield* Effect.gen(function* () {
      const store = yield* ProjectStore.ProjectStoreV2;
      const projects = (yield* store.list({ includeDeleted: true })).map((row) => ({
        ...row,
        id: row.projectId,
      }));
      return { projects };
    }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));
  });

const withLiveProjectCliServer = <A, E, R>(baseDir: string, run: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    const routesLayer = HttpApiBuilder.layer(ProjectCliHttpApi).pipe(
      Layer.provide(projectHttpApiLayer),
      Layer.provide(
        Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => effect,
        }),
      ),
      Layer.provide(environmentAuthenticatedAuthLayer),
    );
    const appLayer = HttpRouter.serve(routesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(
        EnvironmentAuth.layer.pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerSecretStore.layer),
        ),
      ),
      Layer.provideMerge(makeProjectPersistenceLayer(config)),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: 0,
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(ServerConfig.layer(config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          assert.fail(`Expected TCP address, got ${address}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({
            config,
            port: address.port,
          }),
        });
        return yield* run();
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
    );
  });

it.layer(NodeServices.layer)("bin cli parsing", (it) => {
  it.effect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  it.effect("accepts canonical --no-<flag> boolean negation", () =>
    runCliWithRuntime(["--no-log-websocket-events", "--version"]),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("does not expose inherited service commands", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--help"]));

      assert.notInclude(output, "\n  service ");
    }),
  );

  it.effect("executes auth pairing subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-auth-pairing-test-"),
      );

      const createdOutput = yield* captureStdout(
        runCli(["auth", "pairing", "create", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const created = JSON.parse(createdOutput.output) as {
        readonly id: string;
        readonly credential: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly id: string;
        readonly credential?: string;
      }>;

      assert.equal(typeof created.id, "string");
      assert.equal(typeof created.credential, "string");
      assert.equal(created.credential.length > 0, true);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, created.id);
      assert.equal("credential" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("executes auth session subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-auth-session-test-"),
      );

      const issuedOutput = yield* captureStdout(
        runCli(["auth", "session", "issue", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const issued = JSON.parse(issuedOutput.output) as {
        readonly sessionId: string;
        readonly token: string;
        readonly scopes: ReadonlyArray<string>;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "session", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly sessionId: string;
        readonly token?: string;
        readonly scopes: ReadonlyArray<string>;
      }>;

      assert.equal(typeof issued.sessionId, "string");
      assert.equal(typeof issued.token, "string");
      assert.deepEqual(issued.scopes, [
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "access:read",
        "access:write",
      ]);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.sessionId, issued.sessionId);
      assert.deepEqual(listed[0]?.scopes, [
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "access:read",
        "access:write",
      ]);
      assert.equal("token" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("rejects invalid ttl values before running auth commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["auth", "pairing", "create", "--ttl", "soon"]).pipe(
        Effect.flip,
      );

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["test-rig", "auth", "pairing", "create"]);
      const ttlError = error.errors[0] as CliError.CliError | undefined;
      if (!ttlError || ttlError._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${String(ttlError?._tag)}`);
      }
      assert.equal(ttlError.option, "ttl");
      assert.equal(ttlError.value, "soon");
      assert.isTrue(ttlError.message.includes("Invalid duration"));
      assert.isTrue(ttlError.message.includes("5m, 1h, 30d, or 15 minutes"));
    }),
  );

  it.effect("adds, renames, and removes projects offline through the orchestration engine", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-offline-test-"),
      );
      const workspaceRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-workspace-"),
      );

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Alpha",
        "--base-dir",
        baseDir,
      ]);
      const afterAdd = yield* readPersistedSnapshot(baseDir);
      const addedProject = afterAdd.projects.find(
        (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
      );
      assert.isTrue(addedProject !== undefined);
      assert.equal(addedProject?.title, "Alpha");

      yield* runCliWithRuntime(["project", "rename", workspaceRoot, "Beta", "--base-dir", baseDir]);
      const afterRename = yield* readPersistedSnapshot(baseDir);
      const renamedProject = afterRename.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.equal(renamedProject?.title, "Beta");
      assert.equal(renamedProject?.deletedAt, null);

      yield* runCliWithRuntime([
        "project",
        "remove",
        addedProject?.id ?? "",
        "--base-dir",
        baseDir,
      ]);
      const afterRemove = yield* readPersistedSnapshot(baseDir);
      const removedProject = afterRemove.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.isTrue((removedProject?.deletedAt ?? null) !== null);
    }),
  );

  it.effect("force removes projects that still contain threads", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-force-remove-test-"),
      );
      const workspaceRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-force-remove-workspace-"),
      );

      yield* runCliWithRuntime(["project", "add", workspaceRoot, "--base-dir", baseDir]);
      const afterAdd = yield* readPersistedSnapshot(baseDir);
      const project = afterAdd.projects.find(
        (candidate) => candidate.workspaceRoot === workspaceRoot && candidate.deletedAt === null,
      );
      assert.isTrue(project !== undefined);

      const config = yield* makeCliTestServerConfig(baseDir);
      yield* Effect.gen(function* () {
        const sink = yield* EventSink.EventSinkV2;
        const threadId = ThreadId.make("thread-cli-force-remove");
        const now = yield* DateTime.now;
        yield* sink.write({
          events: [
            {
              id: EventId.make("seed-force-remove"),
              type: "thread.created",
              threadId,
              occurredAt: now,
              payload: {
                ...v2Projection.thread,
                id: threadId,
                projectId: project!.id,
                lineage: {
                  rootThreadId: threadId,
                  parentThreadId: null,
                  relationshipToParent: null,
                },
                createdAt: now,
                updatedAt: now,
              },
            },
          ],
        });
      }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));

      yield* runCliWithRuntime([
        "project",
        "remove",
        project!.id,
        "--force",
        "--base-dir",
        baseDir,
      ]);
      const afterRemove = yield* readPersistedSnapshot(baseDir);
      assert.isTrue(
        (afterRemove.projects.find((candidate) => candidate.id === project!.id)?.deletedAt ??
          null) !== null,
      );
      const removedThread = yield* Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        return yield* projections.getThreadRecords(ThreadId.make("thread-cli-force-remove"), []);
      }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));
      assert.isNotNull(removedThread.thread.deletedAt);
    }),
  );

  it.effect("routes project commands through a running server when runtime state is present", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-live-test-"),
      );
      const workspaceRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-live-workspace-"),
      );

      yield* withLiveProjectCliServer(baseDir, () =>
        Effect.gen(function* () {
          yield* runCliWithRuntime([
            "project",
            "add",
            workspaceRoot,
            "--title",
            "Live Project",
            "--base-dir",
            baseDir,
          ]);
          const projects = yield* ProjectService.ProjectService;
          const readModel = yield* projects.snapshot;
          const addedProject = readModel.projects.find(
            (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
          );
          assert.isTrue(addedProject !== undefined);
          assert.equal(addedProject?.title, "Live Project");
        }),
      );
    }),
  );

  it.effect("rejects dev-url on project commands", () =>
    Effect.gen(function* () {
      const workspaceRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3-cli-projects-unknown-option-workspace-"),
      );
      const error = yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--dev-url",
        "http://127.0.0.1:5173",
      ]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["test-rig", "project", "add"]);
      const optionError = error.errors[0] as CliError.CliError | undefined;
      if (!optionError || optionError._tag !== "UnrecognizedOption") {
        assert.fail(`Expected UnrecognizedOption, got ${String(optionError?._tag)}`);
      }
      assert.equal(optionError.option, "--dev-url");
    }),
  );
});
