import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  SKILL_LIBRARY_MAX_IMPORT_BYTES,
  type SkillLibraryUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { parse } from "yaml";
import * as ServerConfig from "../config.ts";
import { SkillLibraryService, layer } from "./SkillLibrary.ts";

const project = ProjectId.make("project-one");
const fields: SkillLibraryUpsertInput = {
  name: "Review notes",
  description: "Review changes carefully.",
  instructions: "# Review\nKeep evidence concise.\n",
  providers: ["codex", "claudeAgent"],
  assignment: { allProjects: false, projectIds: [], disabledProjectIds: [] },
};

const withLibrary = Effect.fn(function* <A, E, R>(
  test: (root: string) => Effect.Effect<A, E, R | SkillLibraryService>,
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-skills-" });
  return yield* test(root).pipe(
    Effect.provide(layer.pipe(Layer.provide(ServerConfig.layerTest(root, root)))),
  );
});

it.layer(NodeServices.layer)("SkillLibrary", (it) => {
  it.effect("saves unassigned, updates one copy, filters availability and deletes", () =>
    withLibrary(() =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        assert.deepEqual(yield* library.list, { skills: [] });
        const created = yield* library.upsert(fields);
        assert.deepEqual(created.supportingFiles, []);
        assert.equal(created.instructions, fields.instructions);
        assert.equal(
          yield* library.resolveCatalogue({ projectId: project, provider: "codex" }),
          undefined,
        );
        const assigned = yield* library.upsert({
          ...fields,
          id: created.id,
          instructions: "New instructions",
          assignment: {
            allProjects: true,
            projectIds: [],
            disabledProjectIds: [ProjectId.make("other")],
          },
        });
        assert.equal(assigned.path, created.path);
        assert.equal(assigned.createdAt, created.createdAt);
        assert.equal((yield* library.list).skills.length, 1);
        assert.equal("instructions" in (yield* library.list).skills[0]!, false);
        const catalogue = yield* library.resolveCatalogue({
          projectId: project,
          provider: "codex",
        });
        assert.ok(catalogue?.includes(`$test-rig:${created.id}`));
        assert.ok(catalogue?.includes(created.path));
        assert.equal(catalogue?.includes("New instructions"), false);
        assert.equal(
          yield* library.resolveCatalogue({ projectId: project, provider: "opencode" }),
          undefined,
        );
        assert.equal(
          yield* library.resolveCatalogue({
            projectId: ProjectId.make("other"),
            provider: "codex",
          }),
          undefined,
        );
        yield* library.delete({ id: created.id });
        assert.deepEqual(yield* library.list, { skills: [] });
        assert.equal((yield* Effect.exit(library.read({ id: created.id })))._tag, "Failure");
      }),
    ),
  );

  it.effect("keeps same-name skills independent through stable identities", () =>
    withLibrary(() =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        const first = yield* library.upsert(fields);
        const second = yield* library.upsert({ ...fields, instructions: "Second" });
        assert.notEqual(first.id, second.id);
        yield* library.delete({ id: first.id });
        assert.equal((yield* library.read({ id: second.id })).instructions, "Second");
      }),
    ),
  );

  it.effect("serializes concurrent saves without dropping skills", () =>
    withLibrary(() =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        yield* Effect.all([library.upsert(fields), library.upsert({ ...fields, name: "Second" })], {
          concurrency: "unbounded",
        });
        assert.equal((yield* library.list).skills.length, 2);
      }),
    ),
  );

  it.effect("copies supporting files and preserves unknown frontmatter when edited", () =>
    withLibrary((root) =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sourceDir = path.join(root, "native", "review");
        const sourcePath = path.join(sourceDir, "SKILL.md");
        yield* fs.makeDirectory(path.join(sourceDir, "scripts"), { recursive: true });
        yield* fs.makeDirectory(path.join(sourceDir, "templates", "empty"), { recursive: true });
        yield* fs.writeFileString(
          sourcePath,
          "---\nname: native-review\ndescription: Native review\nallowed-tools: Read\ncustom:\n  keep: true\n---\n\nRead scripts/check.sh.\n",
        );
        yield* fs.writeFileString(
          path.join(sourceDir, "scripts", "check.sh"),
          "#!/bin/sh\nprintf ok\n",
        );
        yield* fs.chmod(path.join(sourceDir, "scripts", "check.sh"), 0o755);
        const native = { name: "native-review", path: sourcePath, enabled: true };
        const input = {
          instanceId: ProviderInstanceId.make("codex-test"),
          cwd: root,
          sourcePath,
          providers: fields.providers,
          assignment: fields.assignment,
        };
        const source = yield* library.readSource(input, native);
        assert.equal(source.name, "native-review");
        assert.deepEqual(source.supportingFiles, ["scripts/check.sh"]);
        const imported = yield* library.importSkill(input, native);
        assert.notEqual(imported.path, sourcePath);
        assert.deepEqual(imported.supportingFiles, source.supportingFiles);
        const copiedScript = path.join(path.dirname(imported.path), "scripts", "check.sh");
        assert.equal(yield* fs.readFileString(copiedScript), "#!/bin/sh\nprintf ok\n");
        assert.equal((yield* fs.stat(copiedScript)).mode & 0o111, 0o111);
        assert.equal(
          yield* fs.exists(path.join(path.dirname(imported.path), "templates", "empty")),
          true,
        );
        yield* library.upsert({ ...fields, id: imported.id, instructions: "Edited body" });
        const saved = yield* fs.readFileString(imported.path);
        const header = saved.match(/^---\n([\s\S]*?)\n---/);
        const metadata = parse(header![1]!);
        assert.equal(metadata["allowed-tools"], "Read");
        assert.deepEqual(metadata.custom, { keep: true });
        assert.equal((yield* library.read({ id: imported.id })).instructions, "Edited body");
        assert.equal((yield* fs.readFileString(sourcePath)).includes("Edited body"), false);
      }),
    ),
  );

  it.effect(
    "rejects a source outside discovery and symlinked supporting files without publishing a partial import",
    () =>
      withLibrary((root) =>
        Effect.gen(function* () {
          const library = yield* SkillLibraryService;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sourceDir = path.join(root, "native");
          const sourcePath = path.join(sourceDir, "SKILL.md");
          yield* fs.makeDirectory(sourceDir);
          yield* fs.writeFileString(sourcePath, "# Native\n");
          const native = { name: "native", path: sourcePath, enabled: true };
          const input = {
            instanceId: ProviderInstanceId.make("codex-test"),
            cwd: root,
            sourcePath,
            providers: fields.providers,
            assignment: fields.assignment,
          };
          assert.equal(
            (yield* Effect.exit(
              library.importSkill(
                { ...input, sourcePath: path.join(root, "other", "SKILL.md") },
                native,
              ),
            ))._tag,
            "Failure",
          );
          yield* fs.writeFileString(path.join(root, "outside.txt"), "Outside");
          yield* fs.symlink(path.join(root, "outside.txt"), path.join(sourceDir, "linked.txt"));
          assert.equal((yield* Effect.exit(library.importSkill(input, native)))._tag, "Failure");
          assert.deepEqual(yield* library.list, { skills: [] });
        }),
      ),
  );

  it.effect("invalid IDs cannot escape the owned directory", () =>
    withLibrary(() =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        assert.equal((yield* Effect.exit(library.read({ id: "../outside" })))._tag, "Failure");
        assert.equal((yield* Effect.exit(library.delete({ id: "../outside" })))._tag, "Failure");
      }),
    ),
  );

  it.effect("rejects oversized sources and publishes no skill", () =>
    withLibrary((root) =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sourceDir = path.join(root, "oversized");
        const sourcePath = path.join(sourceDir, "SKILL.md");
        yield* fs.makeDirectory(sourceDir);
        yield* fs.writeFileString(sourcePath, "# Too big");
        yield* fs.truncate(sourcePath, SKILL_LIBRARY_MAX_IMPORT_BYTES + 1);
        const native = { name: "oversized", path: sourcePath, enabled: true };
        const input = {
          instanceId: ProviderInstanceId.make("codex-test"),
          cwd: root,
          sourcePath,
          providers: fields.providers,
          assignment: fields.assignment,
        };
        assert.equal((yield* Effect.exit(library.importSkill(input, native)))._tag, "Failure");
        assert.deepEqual(yield* library.list, { skills: [] });
      }),
    ),
  );

  it.effect("reads persisted skills through a fresh service instance", () =>
    withLibrary((root) =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        const created = yield* library.upsert(fields);
        const restored = yield* Effect.gen(function* () {
          const fresh = yield* SkillLibraryService;
          return yield* fresh.read({ id: created.id });
        }).pipe(
          Effect.provide(
            layer.pipe(Layer.fresh, Layer.provide(ServerConfig.layerTest(root, root))),
          ),
        );
        assert.deepEqual(restored, created);
      }),
    ),
  );

  it.effect(
    "does not publish an import when rewritten metadata pushes the folder beyond its limit",
    () =>
      withLibrary((root) =>
        Effect.gen(function* () {
          const library = yield* SkillLibraryService;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sourceDir = path.join(root, "near-limit");
          const sourcePath = path.join(sourceDir, "SKILL.md");
          const instructions = "# Native\n";
          yield* fs.makeDirectory(sourceDir);
          yield* fs.writeFileString(sourcePath, instructions);
          yield* fs.writeFileString(path.join(sourceDir, "support.bin"), "");
          yield* fs.truncate(
            path.join(sourceDir, "support.bin"),
            SKILL_LIBRARY_MAX_IMPORT_BYTES - Buffer.byteLength(instructions),
          );
          const native = { name: "native", path: sourcePath, enabled: true };
          const input = {
            instanceId: ProviderInstanceId.make("codex-test"),
            cwd: root,
            sourcePath,
            providers: fields.providers,
            assignment: fields.assignment,
          };
          assert.equal((yield* library.readSource(input, native)).instructions, instructions);
          assert.equal((yield* Effect.exit(library.importSkill(input, native)))._tag, "Failure");
          assert.deepEqual(yield* library.list, { skills: [] });
        }),
      ),
  );

  it.effect("reads wait for an atomic update and never expose its temporary supporting files", () =>
    withLibrary((root) =>
      Effect.gen(function* () {
        const library = yield* SkillLibraryService;
        const fs = yield* FileSystem.FileSystem;
        const created = yield* library.upsert(fields);
        const renameStarted = yield* Deferred.make<void>();
        const finishRename = yield* Deferred.make<void>();
        const readFinished = yield* Deferred.make<void>();
        const controlledFs = FileSystem.FileSystem.of({
          ...fs,
          rename: (from, to) =>
            to === created.path
              ? Deferred.succeed(renameStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(finishRename)),
                  Effect.andThen(fs.rename(from, to)),
                )
              : fs.rename(from, to),
        });
        yield* Effect.gen(function* () {
          const fresh = yield* SkillLibraryService;
          const updating = yield* fresh
            .upsert({ ...fields, id: created.id, instructions: "Updated" })
            .pipe(Effect.forkChild);
          yield* Deferred.await(renameStarted);
          const reading = yield* fresh.read({ id: created.id }).pipe(
            Effect.tap(() => Deferred.succeed(readFinished, undefined)),
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          assert.equal(yield* Deferred.isDone(readFinished), false);
          yield* Deferred.succeed(finishRename, undefined);
          yield* Fiber.join(updating);
          const detail = yield* Fiber.join(reading);
          assert.equal(detail.instructions, "Updated");
          assert.deepEqual(detail.supportingFiles, []);
        }).pipe(
          Effect.provide(
            layer.pipe(Layer.fresh, Layer.provide(ServerConfig.layerTest(root, root))),
          ),
          Effect.provideService(FileSystem.FileSystem, controlledFs),
        );
      }),
    ),
  );
});
