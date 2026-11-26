// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  NodeId,
  ProjectId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceFolders from "../workspace/WorkspaceFolders.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as IdAllocator from "./IdAllocator.ts";

const VcsProcessLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const CheckpointStoreLayer = CheckpointStore.layer.pipe(
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessLayer))),
  Layer.provide(NodeServices.layer),
);

const threadId = ThreadId.make("thread:repositories");
const now = DateTime.makeUnsafe("2026-11-25T00:00:00.000Z");
const rootScope: (cwd: string) => OrchestrationV2CheckpointScope = (cwd) => ({
  id: CheckpointScopeId.make("scope:repositories:root"),
  threadId,
  runId: RunId.make("run:repositories:1"),
  nodeId: NodeId.make("node:repositories:1"),
  parentScopeId: null,
  providerThreadId: ProviderThreadId.make("provider-thread:repositories"),
  kind: "root_run",
  ordinalWithinParent: 0,
  advancesAppRunCount: true,
  cwd,
  createdAt: now,
});

const git = (cwd: string, args: ReadonlyArray<string>) =>
  VcsProcess.VcsProcess.pipe(
    Effect.flatMap((process) =>
      process.run({ operation: "test.git", command: "git", cwd, args, timeoutMs: 10_000 }),
    ),
  );

const makeRepository = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(cwd, { recursive: true });
    yield* git(cwd, ["init", "-q", "-b", "main"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* fileSystem.writeFileString(NodePath.join(cwd, "index.ts"), "export const a = 1;\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-q", "-m", "init"]);
  });

/** A plain project folder holding `api` and `web`, as the workspace service would report it. */
const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "checkpoint-repositories-" }),
  );
  yield* makeRepository(NodePath.join(root, "api"));
  yield* makeRepository(NodePath.join(root, "web"));
  const folders = ["api", "web"].map((name) => ({
    name,
    path: NodePath.join(root, name),
    isGitRepository: true,
  }));
  const service = yield* CheckpointService.CheckpointServiceV2.pipe(
    Effect.provide(
      CheckpointService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            CheckpointStoreLayer,
            IdAllocator.layer,
            NodeServices.layer,
            Layer.succeed(
              WorkspaceFolders.WorkspaceFolders,
              WorkspaceFolders.WorkspaceFolders.of({
                forThread: () => Effect.succeed({ folders, extraRoots: [] }),
                submodules: () => Effect.succeed([]),
                list: () => Effect.die("unused"),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  const repositories = yield* service.repositoryScopes({
    rootScope: rootScope(root),
    projectId: ProjectId.make("project:repositories"),
    worktreePath: null,
  });
  return { root, service, repositories };
});

const runCapture = (
  service: CheckpointService.CheckpointServiceV2Shape,
  scope: OrchestrationV2CheckpointScope,
  ordinal: number,
) =>
  service.captureRepository({
    scope,
    runId: RunId.make(`run:repositories:${ordinal}`),
    nodeId: NodeId.make(`node:repositories:${ordinal}`),
    ordinalWithinScope: ordinal,
    capturedAt: now,
    baselineCapturedAt: now,
    baselineRecorded: false,
  });

it.layer(Layer.merge(NodeServices.layer, VcsProcessLayer))(
  "CheckpointService repositories",
  (it) => {
    it.effect("names one scope per repository, under the thread's folder", () =>
      Effect.gen(function* () {
        const { repositories } = yield* setup;
        assert.deepEqual(
          repositories.scopes.map((scope) => [scope.kind, scope.label, scope.relativePath]),
          [
            ["repository", "api", "api"],
            ["repository", "web", "web"],
          ],
        );
        // Their files are left out of the root snapshot.
        assert.deepEqual(repositories.rootExcludePaths, ["api", "web"]);
      }),
    );

    it.effect("records only a repository the run changed, with its baseline", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, service, repositories } = yield* setup;
        const [api, web] = repositories.scopes;
        assert.isDefined(api);
        assert.isDefined(web);
        // Both start clean: a status each, nothing written.
        yield* service.captureRepositoryBaseline({ scope: api!, ordinalWithinScope: 0 });
        yield* service.captureRepositoryBaseline({ scope: web!, ordinalWithinScope: 0 });
        yield* fileSystem.writeFileString(
          NodePath.join(root, "api", "index.ts"),
          "export const a = 2;\n",
        );

        const apiCapture = yield* runCapture(service, api!, 1);
        assert.isTrue(Option.isSome(apiCapture));
        const captured = Option.getOrThrow(apiCapture);
        assert.equal(captured.baseline?.ordinalWithinScope, 0);
        assert.isNull(captured.checkpoint.appRunOrdinal);
        assert.deepEqual(
          captured.checkpoint.files.map((file) => [file.path, file.additions, file.deletions]),
          [["index.ts", 1, 1]],
        );
        assert.isTrue(Option.isNone(yield* runCapture(service, web!, 1)));
      }),
    );

    it.effect("records a change to a repository that already had uncommitted work", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, service, repositories } = yield* setup;
        const api = repositories.scopes[0]!;
        const file = NodePath.join(root, "api", "index.ts");
        yield* fileSystem.writeFileString(file, "export const a = 2;\n");
        yield* service.captureRepositoryBaseline({ scope: api, ordinalWithinScope: 0 });
        // Left as it was: nothing to record.
        assert.isTrue(Option.isNone(yield* runCapture(service, api, 1)));

        yield* service.captureRepositoryBaseline({ scope: api, ordinalWithinScope: 1 });
        yield* fileSystem.writeFileString(file, "export const a = 3;\n");
        const captured = Option.getOrThrow(yield* runCapture(service, api, 2));
        assert.deepEqual(
          captured.checkpoint.files.map((entry) => entry.path),
          ["index.ts"],
        );
      }),
    );

    it.effect("records a new file even when the repository hides untracked files", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, service, repositories } = yield* setup;
        const api = repositories.scopes[0]!;
        yield* git(NodePath.join(root, "api"), ["config", "status.showUntrackedFiles", "no"]);
        yield* service.captureRepositoryBaseline({ scope: api, ordinalWithinScope: 0 });
        yield* fileSystem.writeFileString(NodePath.join(root, "api", "new.ts"), "x\n");
        const captured = Option.getOrThrow(yield* runCapture(service, api, 1));
        assert.deepEqual(
          captured.checkpoint.files.map((entry) => entry.path),
          ["new.ts"],
        );
      }),
    );

    it.effect("shows nothing for a repository whose state before the run was never seen", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, service, repositories } = yield* setup;
        const api = repositories.scopes[0]!;
        yield* fileSystem.writeFileString(NodePath.join(root, "api", "new.ts"), "x\n");
        assert.isTrue(Option.isNone(yield* runCapture(service, api, 1)));
      }),
    );
  },
);
