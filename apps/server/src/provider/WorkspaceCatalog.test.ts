import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type SkillLibrarySummary,
  ToolsScopeId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { V2SqlitePersistenceMemory } from "../persistence/Layers/V2Sqlite.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { SkillLibraryService } from "../skills/SkillLibrary.ts";
import { ToolsProjectScopesService } from "../skills/ToolsProjectScopes.ts";

import {
  mergeLibrarySkills,
  readProviderWorkspaceCatalog,
  resolveSkillSourcePaths,
  resolveLibraryWorkspaceScope,
} from "./WorkspaceCatalog.ts";

const projectId = ProjectId.make("skill-picker-project");
const assigned: SkillLibrarySummary = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "review",
  description: "Review the changes",
  providers: ["codex", "claudeAgent"],
  assignment: { allProjects: false, projectIds: [projectId], disabledProjectIds: [] },
  path: "/state/library/review/SKILL.md",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
};
const libraryLayer = Layer.succeed(SkillLibraryService, {
  list: Effect.succeed({ skills: [assigned] }),
  read: () => Effect.die("Unexpected full skill read"),
  upsert: () => Effect.die("Unexpected skill write"),
  delete: () => Effect.die("Unexpected skill delete"),
  importSkill: () => Effect.die("Unexpected skill import"),
  readSource: () => Effect.die("Unexpected source read"),
  resolveCatalogue: () => Effect.die("Unexpected runtime catalogue read"),
});

it.layer(
  Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(ToolsProjectScopesService, {
      list: () => Effect.succeed({ scopes: [] }),
      resolve: (id) =>
        Effect.succeed({ scopeId: ToolsScopeId.make(`project:${id}`), projectIds: [id] }),
    }),
    libraryLayer,
    ProjectStore.layer.pipe(Layer.provideMerge(V2SqlitePersistenceMemory)),
  ),
)("workspace skill catalogue", (catalogTests) => {
  catalogTests.effect(
    "routes repeated workspace reads through the selected instance without refreshing health",
    () =>
      Effect.gen(function* () {
        const reads: Array<[string, string]> = [];
        const first = ProviderInstanceId.make("codex-first");
        const second = ProviderInstanceId.make("codex-second");
        const getInstance = (id: ProviderInstanceId) =>
          Effect.succeed({
            enabled: true,
            driverKind: ProviderDriverKind.make("codex"),
            getWorkspaceCatalog: (cwd: string) =>
              Effect.sync(() => {
                reads.push([id, cwd]);
                return {
                  skills: [{ name: "review", enabled: true, path: `${cwd}/${id}/SKILL.md` }],
                  slashCommands: [{ name: id }],
                };
              }),
          });
        for (const [instanceId, cwd] of [
          [first, "/repo/first"],
          [first, "/repo/second"],
          [first, "/worktrees/first"],
          [second, "/repo/first"],
          [first, "/repo/first"],
        ] as const) {
          const catalog = yield* readProviderWorkspaceCatalog({ instanceId, cwd }, getInstance);
          assert.strictEqual(catalog.skills[0]?.path, `${cwd}/${instanceId}/SKILL.md`);
          assert.strictEqual(catalog.slashCommands[0]?.name, instanceId);
        }
        assert.deepEqual(reads, [
          [first, "/repo/first"],
          [first, "/repo/second"],
          [first, "/worktrees/first"],
          [second, "/repo/first"],
          [first, "/repo/first"],
        ]);
      }),
  );

  catalogTests.effect("does not run discovery for disabled, absent or unscoped instances", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex-test");
      const disabled = {
        enabled: false,
        driverKind: ProviderDriverKind.make("codex"),
        getWorkspaceCatalog: () => Effect.die("Disabled discovery ran"),
      };
      const empty = { skills: [], slashCommands: [] };
      for (const instance of [undefined, disabled]) {
        assert.deepEqual(
          yield* readProviderWorkspaceCatalog({ instanceId, cwd: "/repo" }, () =>
            Effect.succeed(instance),
          ),
          empty,
        );
      }
      assert.deepEqual(
        yield* readProviderWorkspaceCatalog({ instanceId, cwd: " " }, () =>
          Effect.succeed({ ...disabled, enabled: true }),
        ),
        empty,
      );
    }),
  );

  catalogTests.effect(
    "merges assigned metadata for registered roots and exact known worktrees",
    () =>
      Effect.gen(function* () {
        const projects = yield* ProjectStore.ProjectStoreV2;
        const sql = yield* SqlClient.SqlClient;
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make("skill-picker-project-created"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: assigned.createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "Picker",
            workspaceRoot: "/skill-picker/repo",
            defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
            scripts: [],
            createdAt: assigned.createdAt,
            updatedAt: assigned.updatedAt,
          },
        });
        yield* sql`INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, provider_instance_id, runtime_mode,
      interaction_mode, created_at, updated_at, payload_json
    ) VALUES (
      'skill-picker-thread', ${projectId}, 'Worktree', 'codex', 'codex', 'approval-required',
      'default', ${assigned.createdAt}, ${assigned.updatedAt}, '{"worktreePath":"/skill-picker/worktree"}'
    )`;
        const instanceId = ProviderInstanceId.make("codex-picker");
        const getInstance = () =>
          Effect.succeed({
            enabled: true,
            driverKind: ProviderDriverKind.make("codex"),
            getWorkspaceCatalog: () =>
              Effect.succeed({
                skills: [{ name: "review", enabled: true, path: "/native/SKILL.md" }],
                slashCommands: [],
              }),
          });
        for (const cwd of ["/skill-picker/repo", "/skill-picker/repo/", "/skill-picker/worktree"]) {
          const catalog = yield* readProviderWorkspaceCatalog({ instanceId, cwd }, getInstance);
          assert.deepEqual(
            catalog.skills.map((skill) => skill.name),
            ["review", `test-rig:${assigned.id}`],
          );
          assert.strictEqual(catalog.skills[1]?.displayName, "review");
          assert.strictEqual(catalog.skills[1]?.source, "test-rig");
          assert.isFalse("instructions" in catalog.skills[1]!);
        }
        assert.isNull(yield* resolveLibraryWorkspaceScope("/skill-picker/repo/subdirectory"));
        assert.isNull(yield* resolveLibraryWorkspaceScope("/skill-picker/unknown"));
        yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = ${assigned.updatedAt} WHERE thread_id = 'skill-picker-thread'`;
        assert.isNull(yield* resolveLibraryWorkspaceScope("/skill-picker/worktree"));
        yield* sql`UPDATE projection_projects SET deleted_at = ${assigned.updatedAt} WHERE project_id = ${projectId}`;
        assert.isNull(yield* resolveLibraryWorkspaceScope("/skill-picker/repo"));
      }),
  );
  catalogTests.effect("rejects ambiguous root and worktree ownership across active projects", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectStore.ProjectStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const first = ProjectId.make("skill-picker-ambiguity-first");
      const second = ProjectId.make("skill-picker-ambiguity-second");
      for (const [id, root] of [
        [first, "/skill-picker/ambiguity/root"],
        [second, "/skill-picker/ambiguity/worktree"],
      ] as const) {
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make(`created-${id}`),
          aggregateKind: "project",
          aggregateId: id,
          occurredAt: assigned.createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId: id,
            title: id,
            workspaceRoot: root,
            defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
            scripts: [],
            createdAt: assigned.createdAt,
            updatedAt: assigned.updatedAt,
          },
        });
      }
      for (const [threadId, id, worktreePath] of [
        ["root-overlap", first, "/skill-picker/ambiguity/worktree"],
        ["own-root-overlap", first, "/skill-picker/ambiguity/root"],
        ["shared-first", first, "/skill-picker/ambiguity/shared"],
        ["shared-second", second, "/skill-picker/ambiguity/shared"],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, provider_instance_id, runtime_mode,
          interaction_mode, created_at, updated_at, payload_json
        ) VALUES (
          ${threadId}, ${id}, ${threadId}, 'codex', 'codex', 'approval-required',
          'default', ${assigned.createdAt}, ${assigned.updatedAt}, json_object('worktreePath', ${worktreePath})
        )`;
      }
      const instanceId = ProviderInstanceId.make("ambiguity-codex");
      const yieldLibrary = yield* SkillLibraryService;
      const read = (cwd: string) =>
        readProviderWorkspaceCatalog({ instanceId, cwd }, () =>
          Effect.succeed({ enabled: true, driverKind: ProviderDriverKind.make("codex") }),
        ).pipe(
          Effect.provideService(SkillLibraryService, {
            ...yieldLibrary,
            list: Effect.succeed({
              skills: [
                {
                  ...assigned,
                  assignment: { allProjects: true, projectIds: [], disabledProjectIds: [] },
                },
              ],
            }),
          }),
        );
      assert.deepEqual((yield* read("/skill-picker/ambiguity/worktree")).skills, []);
      assert.deepEqual((yield* read("/skill-picker/ambiguity/shared")).skills, []);
      assert.strictEqual((yield* read("/skill-picker/ambiguity/root")).skills.length, 1);
      const sharedScope = ToolsScopeId.make(`git:${"a".repeat(64)}`);
      const toolsScopes = yield* ToolsProjectScopesService;
      assert.strictEqual(
        (yield* read("/skill-picker/ambiguity/worktree").pipe(
          Effect.provideService(ToolsProjectScopesService, {
            ...toolsScopes,
            resolve: () => Effect.succeed({ scopeId: sharedScope, projectIds: [first, second] }),
          }),
        )).skills.length,
        1,
      );
      yield* sql`UPDATE projection_projects SET deleted_at = ${assigned.updatedAt} WHERE project_id = ${second}`;
      assert.strictEqual((yield* read("/skill-picker/ambiguity/worktree")).skills.length, 1);
      assert.strictEqual((yield* read("/skill-picker/ambiguity/shared")).skills.length, 1);
    }),
  );
});

it.layer(NodeServices.layer)("native skill source paths", (it) => {
  it.effect("resolves shared directory and file symlinks while retaining provider paths", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "native-skill-paths-" });
      const agents = path.join(root, ".agents", "skills");
      yield* fs.makeDirectory(path.join(agents, "review"), { recursive: true });
      yield* fs.makeDirectory(path.join(root, ".claude"));
      const source = path.join(agents, "review", "SKILL.md");
      yield* fs.writeFileString(source, "Review the changes.");
      yield* fs.symlink(agents, path.join(root, ".claude", "skills"));
      const fileAlias = path.join(root, "SKILL.md");
      yield* fs.symlink(source, fileAlias);
      const providerPaths = [
        source,
        path.join(root, ".claude", "skills", "review", "SKILL.md"),
        fileAlias,
      ];
      const skills = yield* resolveSkillSourcePaths(
        providerPaths.map((path) => ({ name: "review", enabled: true, path })),
      );
      assert.deepEqual(
        skills.map((skill) => skill.path),
        providerPaths,
      );
      assert.deepEqual(
        skills.map((skill) => skill.canonicalPath),
        Array(3).fill(yield* fs.realPath(source)),
      );
    }),
  );
  it.effect("keeps an unavailable source visible and same-name files independent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "native-skill-files-" });
      const first = path.join(root, "first.md");
      const second = path.join(root, "second.md");
      yield* fs.writeFileString(first, "Same instructions.");
      yield* fs.writeFileString(second, "Same instructions.");
      const missing = { name: "review", enabled: true, path: path.join(root, "missing.md") };
      const skills = yield* resolveSkillSourcePaths([
        { ...missing, path: first },
        { ...missing, path: second },
        missing,
      ]);
      assert.notEqual(skills[0]?.canonicalPath, skills[1]?.canonicalPath);
      assert.deepEqual(skills[2], missing);
    }),
  );
});

it("filters library metadata by provider, assignment and project exclusion", () => {
  const catalog = { skills: [], slashCommands: [] };
  assert.strictEqual(mergeLibrarySkills(catalog, [assigned], projectId, "codex").skills.length, 1);
  for (const [target, provider] of [
    [ProjectId.make("different"), "codex"],
    [projectId, "opencode"],
    [null, "codex"],
  ] as const) {
    assert.deepEqual(mergeLibrarySkills(catalog, [assigned], target, provider), catalog);
  }
  const allProjects = {
    ...assigned,
    assignment: { allProjects: true, projectIds: [], disabledProjectIds: [projectId] },
  };
  assert.deepEqual(mergeLibrarySkills(catalog, [allProjects], projectId, "codex"), catalog);
  assert.strictEqual(
    mergeLibrarySkills(
      catalog,
      [{ ...allProjects, assignment: { ...allProjects.assignment, disabledProjectIds: [] } }],
      projectId,
      "codex",
    ).skills.length,
    1,
  );
});
