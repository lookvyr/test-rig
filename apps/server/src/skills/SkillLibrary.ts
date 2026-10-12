import * as NodeCrypto from "node:crypto";
import {
  SKILL_LIBRARY_MAX_IMPORT_BYTES,
  SKILL_LIBRARY_MAX_SKILLS,
  SKILL_LIBRARY_MAX_SUPPORTING_FILES,
  SkillLibraryDetail,
  SkillLibraryError,
  SkillLibraryId,
  SkillLibraryImportInput,
  SkillLibrarySourceReadInput,
  SkillLibrarySourceDetail,
  SkillLibrarySummary,
  SkillLibraryUpsertInput,
  isSkillLibrarySkillAvailable,
  type ProjectId,
  type ServerProviderSkill,
  type SkillLibraryListResult,
  type SkillLibraryReadInput,
  type ToolsScopeId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { parse, stringify } from "yaml";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";

export class SkillLibraryService extends Context.Service<
  SkillLibraryService,
  {
    readonly list: Effect.Effect<SkillLibraryListResult, SkillLibraryError>;
    readonly read: (
      input: SkillLibraryReadInput,
    ) => Effect.Effect<SkillLibraryDetail, SkillLibraryError>;
    readonly upsert: (
      input: SkillLibraryUpsertInput,
    ) => Effect.Effect<SkillLibraryDetail, SkillLibraryError>;
    readonly delete: (input: SkillLibraryReadInput) => Effect.Effect<void, SkillLibraryError>;
    /** The caller must obtain the source from the selected provider's discovery. */
    readonly importSkill: (
      input: SkillLibraryImportInput,
      source: ServerProviderSkill,
    ) => Effect.Effect<SkillLibraryDetail, SkillLibraryError>;
    readonly readSource: (
      input: SkillLibrarySourceReadInput,
      source: ServerProviderSkill,
    ) => Effect.Effect<SkillLibrarySourceDetail, SkillLibraryError>;
    readonly resolveCatalogue: (input: {
      readonly projectId: ProjectId | null;
      readonly provider: string;
      readonly scopeId?: ToolsScopeId | null;
      readonly memberProjectIds?: ReadonlyArray<ProjectId>;
    }) => Effect.Effect<string | undefined, SkillLibraryError>;
  }
>()("t3/skills/SkillLibrary/SkillLibraryService") {}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseDocument(contents: string) {
  const match = frontmatterPattern.exec(contents);
  if (!match) return { frontmatter: {} as Record<string, unknown>, instructions: contents };
  const parsed: unknown = parse(match[1]!);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Skill frontmatter must be an object.");
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    instructions: contents.slice(match[0].length),
  };
}

const fail = (message: string) => new SkillLibraryError({ operation: "library", message });

export const layer = Layer.effect(
  SkillLibraryService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const mutex = yield* Semaphore.make(1);
    const configuredRoot = path.join(config.stateDir, "skills-library");

    const protect = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new SkillLibraryError({
              operation,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        ),
      );

    const rootDirectory = Effect.fn(function* (create = false) {
      if (create) yield* fs.makeDirectory(configuredRoot, { recursive: true });
      return yield* fs.realPath(configuredRoot);
    });

    const ensureRegularPath = Effect.fn(function* (filePath: string) {
      if ((yield* fs.realPath(filePath)) !== filePath) {
        return yield* fail("Skill folders cannot contain symbolic links.");
      }
      return yield* fs.stat(filePath);
    });

    const readDocument = Effect.fn(function* (filePath: string) {
      const info = yield* ensureRegularPath(filePath);
      if (info.type !== "File" || Number(info.size) > SKILL_LIBRARY_MAX_IMPORT_BYTES) {
        return yield* fail("The skill document is not a regular file or exceeds the import limit.");
      }
      const contents = yield* fs.readFileString(filePath);
      return yield* Effect.try({
        try: () => parseDocument(contents),
        catch: (cause) => fail(cause instanceof Error ? cause.message : String(cause)),
      });
    });

    const collectFiles = Effect.fn(function* (directory: string) {
      const files: Array<{ relativePath: string; mode: number; size: number }> = [];
      const directories: string[] = [];
      let entries = 0;
      let bytes = 0;
      const walk = Effect.fn(function* (
        relativeDirectory: string,
      ): Effect.fn.Return<void, PlatformError.PlatformError | SkillLibraryError> {
        const current = path.join(directory, relativeDirectory);
        for (const name of (yield* fs.readDirectory(current)).sort()) {
          entries += 1;
          if (entries > SKILL_LIBRARY_MAX_SUPPORTING_FILES + 1)
            return yield* fail("The skill folder has too many files or directories.");
          const relativePath = path.join(relativeDirectory, name);
          const info = yield* ensureRegularPath(path.join(directory, relativePath));
          if (info.type === "Directory") {
            directories.push(relativePath);
            yield* walk(relativePath);
          } else if (info.type === "File") {
            bytes += Number(info.size);
            if (bytes > SKILL_LIBRARY_MAX_IMPORT_BYTES)
              return yield* fail("The skill folder exceeds the import size limit.");
            files.push({ relativePath, mode: info.mode, size: Number(info.size) });
          } else
            return yield* fail("Skill folders can contain only regular files and directories.");
        }
      });
      yield* walk("");
      return { files, directories, bytes };
    });

    const stored = Effect.fn(function* (id: string) {
      yield* Schema.decodeUnknownEffect(SkillLibraryId)(id);
      const root = yield* rootDirectory();
      const directory = path.join(root, id);
      yield* ensureRegularPath(directory);
      const skillPath = path.join(directory, "SKILL.md");
      const document = yield* readDocument(skillPath);
      const summary = yield* Schema.decodeUnknownEffect(SkillLibrarySummary)({
        name: document.frontmatter.name,
        description: document.frontmatter.description,
        ...(typeof document.frontmatter.testRig === "object" &&
        document.frontmatter.testRig !== null
          ? document.frontmatter.testRig
          : {}),
        id,
        path: skillPath,
      });
      return { directory, document, summary };
    });

    const list = protect(
      "list",
      Effect.gen(function* () {
        if (!(yield* fs.exists(configuredRoot))) return { skills: [] };
        const root = yield* rootDirectory();
        const ids = (yield* fs.readDirectory(root)).filter(Schema.is(SkillLibraryId));
        if (ids.length > SKILL_LIBRARY_MAX_SKILLS)
          return yield* fail("The skill library exceeds its size limit.");
        const skills = yield* Effect.forEach(
          ids,
          (id) => stored(id).pipe(Effect.map((entry) => entry.summary)),
          { concurrency: 4 },
        );
        return {
          skills: skills.sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          ),
        };
      }),
    );

    const read = (input: SkillLibraryReadInput) =>
      protect(
        "read",
        Effect.gen(function* () {
          const entry = yield* stored(input.id);
          const { files } = yield* collectFiles(entry.directory);
          return yield* Schema.decodeUnknownEffect(SkillLibraryDetail)({
            ...entry.summary,
            instructions: entry.document.instructions,
            supportingFiles: files
              .filter((file) => file.relativePath !== "SKILL.md")
              .map((file) => file.relativePath),
          });
        }),
      );

    const normalize = (input: SkillLibraryUpsertInput) => ({
      ...input,
      description: input.description.trim(),
      providers: [...new Set(input.providers)],
      assignment: {
        allProjects: input.assignment.allProjects,
        projectIds: input.assignment.allProjects ? [] : [...new Set(input.assignment.projectIds)],
        disabledProjectIds: [...new Set(input.assignment.disabledProjectIds)],
        ...(input.assignment.scopeIds === undefined
          ? {}
          : { scopeIds: [...new Set(input.assignment.scopeIds)] }),
        ...(input.assignment.disabledScopeIds === undefined
          ? {}
          : { disabledScopeIds: [...new Set(input.assignment.disabledScopeIds)] }),
      },
    });

    const writeDocument = Effect.fn(function* (
      summary: SkillLibrarySummary,
      instructions: string,
      previousFrontmatter: Record<string, unknown>,
    ) {
      const { id: _id, path: _path, name, description, ...metadata } = summary;
      const contents = `---\n${stringify({ ...previousFrontmatter, name, description, testRig: metadata })}---\n${instructions}`;
      yield* fs.makeDirectory(path.dirname(summary.path), { recursive: true });
      const current = yield* collectFiles(path.dirname(summary.path));
      const previousDocumentBytes =
        current.files.find((file) => file.relativePath === "SKILL.md")?.size ?? 0;
      if (
        current.bytes - previousDocumentBytes + Buffer.byteLength(contents) >
        SKILL_LIBRARY_MAX_IMPORT_BYTES
      ) {
        return yield* fail("The saved skill folder exceeds the import size limit.");
      }
      yield* writeFileStringAtomically({ filePath: summary.path, contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    });

    const upsert = (input: SkillLibraryUpsertInput) =>
      mutex.withPermits(1)(
        protect(
          "upsert",
          Effect.gen(function* () {
            const validated = normalize(
              yield* Schema.decodeUnknownEffect(SkillLibraryUpsertInput)(input),
            );
            const existing = validated.id === undefined ? undefined : yield* stored(validated.id);
            const skills = (yield* list).skills;
            if (existing === undefined && skills.length >= SKILL_LIBRARY_MAX_SKILLS)
              return yield* fail("The skill library is full.");
            const id = existing?.summary.id ?? NodeCrypto.randomUUID();
            const root = yield* rootDirectory(true);
            const now = DateTime.formatIso(yield* DateTime.now);
            const summary = yield* Schema.decodeUnknownEffect(SkillLibrarySummary)({
              id,
              name: validated.name,
              description: validated.description,
              providers: validated.providers,
              assignment: validated.assignment,
              path: path.join(root, id, "SKILL.md"),
              createdAt: existing?.summary.createdAt ?? now,
              updatedAt: now,
            });
            if (existing !== undefined) {
              yield* writeDocument(summary, validated.instructions, existing.document.frontmatter);
            } else {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const temporary = yield* fs.makeTempDirectoryScoped({
                    directory: root,
                    prefix: ".create-",
                  });
                  const staging = path.join(temporary, "contents");
                  yield* writeDocument(
                    { ...summary, path: path.join(staging, "SKILL.md") },
                    validated.instructions,
                    {},
                  );
                  yield* fs.rename(staging, path.join(root, id));
                }),
              );
            }
            return yield* read({ id });
          }),
        ),
      );

    const sourceDocument = Effect.fn(function* (
      input: SkillLibrarySourceReadInput,
      source: ServerProviderSkill,
    ) {
      yield* Schema.decodeUnknownEffect(SkillLibrarySourceReadInput)(input);
      if (input.sourcePath !== source.path || path.basename(source.path) !== "SKILL.md")
        return yield* fail("Select a discovered SKILL.md source to import.");
      const directory = yield* fs.realPath(path.dirname(path.resolve(source.path)));
      const document = yield* readDocument(path.join(directory, "SKILL.md"));
      const { files, directories } = yield* collectFiles(directory);
      const detail = yield* Schema.decodeUnknownEffect(SkillLibrarySourceDetail)({
        path: source.path,
        name:
          typeof document.frontmatter.name === "string" ? document.frontmatter.name : source.name,
        description:
          typeof document.frontmatter.description === "string"
            ? document.frontmatter.description
            : (source.description ?? ""),
        instructions: document.instructions,
        supportingFiles: files
          .filter((file) => file.relativePath !== "SKILL.md")
          .map((file) => file.relativePath),
      });
      return { directory, document, files, directories, detail };
    });

    const importSkill = (input: SkillLibraryImportInput, source: ServerProviderSkill) =>
      mutex.withPermits(1)(
        protect(
          "import",
          Effect.scoped(
            Effect.gen(function* () {
              const validated = yield* Schema.decodeUnknownEffect(SkillLibraryImportInput)(input);
              const sourceData = yield* sourceDocument(validated, source);
              const fields = normalize(
                yield* Schema.decodeUnknownEffect(SkillLibraryUpsertInput)({
                  ...sourceData.detail,
                  ...(validated.name === undefined ? {} : { name: validated.name }),
                  providers: validated.providers,
                  assignment: validated.assignment,
                }),
              );
              if ((yield* list).skills.length >= SKILL_LIBRARY_MAX_SKILLS)
                return yield* fail("The skill library is full.");
              const root = yield* rootDirectory(true);
              const temporary = yield* fs.makeTempDirectoryScoped({
                directory: root,
                prefix: ".import-",
              });
              const staging = path.join(temporary, "contents");
              yield* fs.makeDirectory(staging);
              for (const directory of sourceData.directories) {
                yield* fs.makeDirectory(path.join(staging, directory), { recursive: true });
              }
              for (const file of sourceData.files) {
                if (file.relativePath === "SKILL.md") continue;
                const destination = path.join(staging, file.relativePath);
                yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
                yield* fs.copyFile(path.join(sourceData.directory, file.relativePath), destination);
                yield* fs.chmod(destination, 0o644 | (file.mode & 0o111));
              }
              const id = NodeCrypto.randomUUID();
              const now = DateTime.formatIso(yield* DateTime.now);
              const summary: SkillLibrarySummary = {
                id,
                name: fields.name,
                description: fields.description,
                providers: fields.providers,
                assignment: fields.assignment,
                path: path.join(staging, "SKILL.md"),
                createdAt: now,
                updatedAt: now,
              };
              yield* writeDocument(summary, fields.instructions, sourceData.document.frontmatter);
              yield* fs.rename(staging, path.join(root, id));
              return yield* read({ id });
            }),
          ),
        ),
      );

    return SkillLibraryService.of({
      list: mutex.withPermits(1)(list),
      read: (input) => mutex.withPermits(1)(read(input)),
      upsert,
      importSkill,
      readSource: (input, source) =>
        protect(
          "read-source",
          sourceDocument(input, source).pipe(Effect.map((entry) => entry.detail)),
        ),
      delete: (input) =>
        mutex.withPermits(1)(
          protect(
            "delete",
            Effect.gen(function* () {
              const entry = yield* stored(input.id);
              yield* fs.remove(entry.directory, { recursive: true });
            }),
          ),
        ),
      resolveCatalogue: (input) =>
        mutex.withPermits(1)(
          list.pipe(
            Effect.map(({ skills }) => {
              const available = skills.filter((skill) =>
                isSkillLibrarySkillAvailable(
                  skill,
                  input.projectId,
                  input.provider,
                  input.scopeId,
                  input.memberProjectIds,
                ),
              );
              if (available.length === 0) return undefined;
              return [
                "## Test Rig skill library",
                "These are app-provided skills, separate from provider-native skills. Use a skill when its description fits the task, or when the user names its alias. Read its SKILL.md before applying it; resolve scripts, references and templates relative to that file's directory. Do not invoke these aliases as native slash commands. Native and repository skills keep their existing behavior.",
                ...available.map(
                  (skill) =>
                    `- ${JSON.stringify(`$test-rig:${skill.id}`)}: ${JSON.stringify(skill.name)}. ${JSON.stringify(skill.description)} Read: ${JSON.stringify(skill.path)}`,
                ),
              ].join("\n");
            }),
          ),
        ),
    });
  }),
);
