import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
  isSkillLibrarySkillAvailable,
} from "@t3tools/contracts";
import { resolveMcpServers } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ToolsProjectScopesService, layer } from "./ToolsProjectScopes.ts";

const services = Layer.merge(
  ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)),
  ProjectStore.layer.pipe(Layer.provideMerge(V2SqlitePersistenceMemory)),
);
it.layer(layer.pipe(Layer.provideMerge(services)))("repository tools scopes", (it) => {
  it.effect(
    "shares no-remote worktrees, separates clones, and survives representative deletion",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const runner = yield* ProcessRunner.ProcessRunner;
          const projects = yield* ProjectStore.ProjectStoreV2;
          const scopes = yield* ToolsProjectScopesService;
          const sql = yield* SqlClient.SqlClient;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-tool-scopes-" });
          const mainPath = path.join(root, "repo");
          const worktreePath = path.join(root, "worktree");
          const clonePath = path.join(root, "clone");
          const futurePath = path.join(root, "future");
          const runGit = Effect.fn(function* (args: string[]) {
            const result = yield* runner.run({ command: "git", args });
            assert.strictEqual(result.code, 0, result.stderr);
          });
          yield* runGit(["init", "-q", mainPath]);
          yield* runGit([
            "-C",
            mainPath,
            "-c",
            "user.name=Tools Test",
            "-c",
            "user.email=tools@example.test",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "fixture",
          ]);
          yield* runGit(["-C", mainPath, "worktree", "add", "--detach", worktreePath]);
          yield* runGit(["clone", "-q", mainPath, clonePath]);
          const register = Effect.fn(function* (id: ProjectId, workspaceRoot: string) {
            yield* projects.apply({
              sequence: 1,
              eventId: EventId.make(`created-${id}`),
              aggregateKind: "project",
              aggregateId: id,
              occurredAt: "2026-10-11T00:00:00.000Z",
              commandId: null,
              causationEventId: null,
              correlationId: null,
              metadata: {},
              type: "project.created",
              payload: {
                projectId: id,
                title: "Same label",
                workspaceRoot,
                defaultModelSelection: {
                  instanceId: ProviderInstanceId.make("codex"),
                  model: "gpt",
                },
                scripts: [],
                createdAt: "2026-10-11T00:00:00.000Z",
                updatedAt: "2026-10-11T00:00:00.000Z",
              },
            });
          });
          const main = ProjectId.make("scope-main"),
            worktree = ProjectId.make("scope-worktree"),
            clone = ProjectId.make("scope-clone"),
            future = ProjectId.make("scope-future");
          yield* register(main, mainPath);
          yield* register(worktree, worktreePath);
          yield* register(clone, clonePath);
          const grouped = yield* scopes.list([main, worktree, clone]);
          assert.strictEqual(grouped.scopes.length, 2);
          const mainScope = yield* scopes.resolve(main);
          const worktreeScope = yield* scopes.resolve(worktree);
          const cloneScope = yield* scopes.resolve(clone);
          assert.strictEqual(mainScope.scopeId, worktreeScope.scopeId);
          assert.notStrictEqual(mainScope.scopeId, cloneScope.scopeId);
          assert.deepEqual(mainScope.projectIds, [main, worktree]);
          assert.deepEqual((yield* scopes.list([worktree])).scopes[0]?.memberProjectIds, [
            worktree,
          ]);
          const legacySkill = {
            providers: ["codex" as const],
            assignment: { allProjects: false, projectIds: [main], disabledProjectIds: [] },
          };
          assert.isTrue(
            isSkillLibrarySkillAvailable(
              legacySkill,
              worktree,
              "codex",
              mainScope.scopeId,
              mainScope.projectIds,
            ),
          );
          const skill = {
            ...legacySkill,
            assignment: {
              ...legacySkill.assignment,
              projectIds: [],
              scopeIds: [mainScope.scopeId],
            },
          };
          const settings = yield* Schema.decodeUnknownEffect(ServerSettings)({
            mcpServers: {
              docs: {
                enabled: true,
                providers: ["codex"],
                transport: { type: "stdio", command: "docs", args: [], env: [] },
              },
            },
            toolsScopeMcpServers: { [mainScope.scopeId]: { docs: { enabled: false } } },
          });
          yield* runGit(["-C", mainPath, "worktree", "add", "--detach", futurePath]);
          yield* register(future, futurePath);
          const futureScope = yield* scopes.resolve(future);
          assert.strictEqual(futureScope.scopeId, mainScope.scopeId);
          assert.isTrue(
            isSkillLibrarySkillAvailable(
              skill,
              future,
              "codex",
              futureScope.scopeId,
              futureScope.projectIds,
            ),
          );
          assert.deepEqual(
            resolveMcpServers(
              settings,
              future,
              ProviderDriverKind.make("codex"),
              futureScope.scopeId,
              futureScope.projectIds,
            ),
            [],
          );
          assert.strictEqual(
            resolveMcpServers(
              settings,
              clone,
              ProviderDriverKind.make("codex"),
              cloneScope.scopeId,
              cloneScope.projectIds,
            ).length,
            1,
          );
          yield* sql`UPDATE projection_projects SET deleted_at = '2026-10-11T00:00:01.000Z' WHERE project_id = ${main}`;
          assert.strictEqual((yield* scopes.resolve(worktree)).scopeId, mainScope.scopeId);
          assert.isTrue(
            isSkillLibrarySkillAvailable(skill, worktree, "codex", mainScope.scopeId, [
              worktree,
              future,
            ]),
          );
        }),
      ),
  );

  it.effect("keeps non-Git folders separate and rejects missing registered workspaces", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projects = yield* ProjectStore.ProjectStoreV2;
        const scopes = yield* ToolsProjectScopesService;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-nongit-scopes-" });
        const id = ProjectId.make("scope-nongit");
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make("scope-nongit-created"),
          aggregateKind: "project",
          aggregateId: id,
          occurredAt: "2026-10-11T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId: id,
            title: "Folder",
            workspaceRoot: root,
            defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
            scripts: [],
            createdAt: "2026-10-11T00:00:00.000Z",
            updatedAt: "2026-10-11T00:00:00.000Z",
          },
        });
        assert.strictEqual((yield* scopes.resolve(id)).scopeId, `project:${id}`);
        yield* projects.apply({
          sequence: 2,
          eventId: EventId.make("scope-missing-created"),
          aggregateKind: "project",
          aggregateId: ProjectId.make("scope-missing"),
          occurredAt: "2026-10-11T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId: ProjectId.make("scope-missing"),
            title: "Missing",
            workspaceRoot: path.join(root, "missing"),
            defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
            scripts: [],
            createdAt: "2026-10-11T00:00:00.000Z",
            updatedAt: "2026-10-11T00:00:00.000Z",
          },
        });
        assert.isTrue(
          (yield* scopes.resolve(ProjectId.make("scope-missing")).pipe(Effect.exit))._tag ===
            "Failure",
        );
      }),
    ),
  );

  it.effect(
    "lists healthy scopes alongside named unavailable workspaces and recovers immediately",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const projects = yield* ProjectStore.ProjectStoreV2;
          const scopes = yield* ToolsProjectScopesService;
          const root = yield* fs.makeTempDirectoryScoped({
            prefix: "test-rig-unavailable-scopes-",
          });
          const healthyPath = path.join(root, "healthy"),
            missingPath = path.join(root, "missing"),
            hiddenPath = path.join(root, "hidden"),
            badGitPath = path.join(root, "bad-git");
          for (const directory of [healthyPath, missingPath, badGitPath])
            yield* fs.makeDirectory(directory);
          const healthy = ProjectId.make("partial-healthy"),
            missing = ProjectId.make("partial-missing"),
            badGit = ProjectId.make("partial-bad-git");
          for (const [id, directory, title] of [
            [healthy, healthyPath, "Healthy"],
            [missing, missingPath, "Unavailable folder"],
            [badGit, badGitPath, "Bad Git folder"],
          ] as const) {
            yield* projects.apply({
              sequence: 1,
              eventId: EventId.make(`created-${id}`),
              aggregateKind: "project",
              aggregateId: id,
              occurredAt: "2026-10-11T00:00:00.000Z",
              commandId: null,
              causationEventId: null,
              correlationId: null,
              metadata: {},
              type: "project.created",
              payload: {
                projectId: id,
                title,
                workspaceRoot: directory,
                defaultModelSelection: {
                  instanceId: ProviderInstanceId.make("codex"),
                  model: "gpt",
                },
                scripts: [],
                createdAt: "2026-10-11T00:00:00.000Z",
                updatedAt: "2026-10-11T00:00:00.000Z",
              },
            });
          }
          const ids = [healthy, missing, badGit];
          const initial = yield* scopes.list([healthy, missing]);
          assert.strictEqual(initial.scopes.length, 2);
          const healthyScope = initial.scopes.find((scope) =>
            scope.memberProjectIds.includes(healthy),
          )!.id;
          yield* fs.rename(missingPath, hiddenPath);
          yield* fs.writeFileString(path.join(badGitPath, ".git"), "invalid gitfile");
          const partial = yield* scopes.list(ids);
          assert.deepEqual(
            partial.scopes.map((scope) => scope.id),
            [healthyScope],
          );
          assert.sameMembers(
            partial.unavailableProjects?.map((project) => project.projectId) ?? [],
            [missing, badGit],
          );
          assert.sameMembers(partial.unavailableProjects?.map((project) => project.title) ?? [], [
            "Unavailable folder",
            "Bad Git folder",
          ]);
          assert.strictEqual(
            partial.unavailableProjects?.find((project) => project.projectId === missing)?.message,
            "The workspace folder is missing or unreadable.",
          );
          assert.isTrue((yield* scopes.resolve(missing).pipe(Effect.exit))._tag === "Failure");
          assert.strictEqual((yield* scopes.resolve(healthy)).scopeId, healthyScope);
          yield* fs.writeFileString(missingPath, "not a directory");
          assert.include(
            (yield* scopes.list([healthy, missing])).unavailableProjects?.[0]?.message ?? "",
            "not a directory",
          );
          yield* fs.remove(missingPath);
          yield* fs.rename(hiddenPath, missingPath);
          yield* fs.remove(path.join(badGitPath, ".git"));
          const restored = yield* scopes.list(ids);
          assert.strictEqual(restored.scopes.length, 3);
          assert.isUndefined(restored.unavailableProjects);
          assert.strictEqual(
            restored.scopes.find((scope) => scope.memberProjectIds.includes(healthy))?.id,
            healthyScope,
          );
          assert.strictEqual((yield* scopes.resolve(missing)).scopeId, `project:${missing}`);
          yield* fs.chmod(missingPath, 0);
          yield* Effect.gen(function* () {
            const unreadable = yield* scopes.list([healthy, missing]);
            assert.deepEqual(
              unreadable.scopes.map((scope) => scope.id),
              [healthyScope],
            );
            assert.strictEqual(unreadable.unavailableProjects?.[0]?.projectId, missing);
          }).pipe(Effect.ensuring(fs.chmod(missingPath, 0o700).pipe(Effect.orDie)));
          assert.strictEqual((yield* scopes.list([healthy, missing])).scopes.length, 2);
        }),
      ),
  );
});
