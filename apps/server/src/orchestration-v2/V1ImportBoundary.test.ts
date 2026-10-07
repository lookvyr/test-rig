// @effect-diagnostics nodeBuiltinImport:off - Static architecture test scans source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

const sourceRoot = NodePath.resolve(import.meta.dirname, "..");
const forbiddenImport =
  /from\s+["'][^"']*(?:ProviderService|ProviderSessionDirectory|ProviderSessionReaper|ProviderCommandReactor|ProviderRuntimeIngestion)[^"']*["']/;
// The V1 read model tables. `projection_projects` is not listed: it is the V2 project store.
const legacyTable =
  /\bprojection_(?:threads|thread_messages|thread_activities|thread_proposed_plans|thread_pull_requests|thread_sessions|turns|pending_approvals|state)\b/;
/** Directories whose files may read the V1 tables: the importer and the schema history. */
const legacyReaders = ["orchestration-v2/legacy/", "persistence/Migrations/"] as const;
const sharedOrchestrationFiles = [
  "orchestration/ScratchWorkspace.ts",
  "orchestration/workflowScriptQuery.ts",
];
const retiredPaths = [
  "orchestration/Layers/OrchestrationEngine.ts",
  "orchestration/Layers/ProviderCommandReactor.ts",
  "orchestration/Layers/ProviderRuntimeIngestion.ts",
  "orchestration/Services/ProviderCommandReactor.ts",
  "orchestration/Services/ProviderRuntimeIngestion.ts",
  "persistence/Services/ProjectionThreads.ts",
  "persistence/Services/ProjectionProjects.ts",
] as const;

/** Historical V1 modules remain as test references; scan what the shipped CLI can reach. */
function productionTypeScriptFiles(entry: string): ReadonlyArray<string> {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = NodeFS.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)(["'])([^"']+)\1/g)) {
      const specifier = match[2]!;
      if (!specifier.startsWith(".")) continue;
      const dependency = NodePath.resolve(NodePath.dirname(file), specifier);
      if (dependency.startsWith(`${sourceRoot}${NodePath.sep}`) && dependency.endsWith(".ts")) {
        pending.push(dependency);
      }
    }
  }
  return [...visited];
}

const relativeSources = productionTypeScriptFiles(NodePath.join(sourceRoot, "bin.ts")).map(
  (path) => ({
    path: NodePath.relative(sourceRoot, path).split(NodePath.sep).join("/"),
    source: NodeFS.readFileSync(path, "utf8"),
  }),
);

it("keeps the V1 agent runtime and engine unreachable from the shipped CLI", () => {
  for (const relativePath of retiredPaths) {
    assert.isFalse(
      relativeSources.some(({ path }) => path === relativePath),
      relativePath,
    );
  }
  assert.deepEqual(
    relativeSources
      .filter(({ path }) => path.startsWith("orchestration/"))
      .map(({ path }) => path)
      .toSorted(),
    sharedOrchestrationFiles.toSorted(),
  );
  const violations = relativeSources
    .filter(({ path, source }) => !path.includes("/legacy/") && forbiddenImport.test(source))
    .map(({ path }) => path);
  assert.deepEqual(violations, []);
});

it("reads the V1 tables only from the legacy importer", () => {
  const readers = relativeSources
    .filter(({ source }) => legacyTable.test(source))
    .map(({ path }) => path)
    .filter((path) => !legacyReaders.some((directory) => path.startsWith(directory)));
  assert.deepEqual(readers, []);
});

it("keeps the legacy importer out of reach of new code", () => {
  const importers = relativeSources
    .filter(
      ({ path, source }) =>
        !path.startsWith("orchestration-v2/legacy/") && /from\s+["'][^"']*\/legacy\//.test(source),
    )
    .map(({ path }) => path)
    .toSorted();
  // Startup imports pending transcripts, the V2 runtime wires the importer, and
  // thread and project services hydrate a V1 transcript before they act on it.
  assert.deepEqual(importers, [
    "orchestration-v2/ThreadManagementService.ts",
    "orchestration-v2/runtimeLayer.ts",
    "project/ProjectService.ts",
    "serverRuntimeStartup.ts",
  ]);
});
