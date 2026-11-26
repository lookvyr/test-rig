import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  otherThreadRepositories,
  threadChangedRepositories,
  threadRepositoryFile,
  threadRepositorySections,
} from "./threadRepositories.ts";

const capturedAt = DateTime.makeUnsafe("2026-11-25T00:00:00.000Z");
const threadId = ThreadId.make("thread:repositories");

const scope = (name: string): OrchestrationV2CheckpointScope => ({
  id: CheckpointScopeId.make(`scope:${name}`),
  threadId,
  runId: null,
  nodeId: NodeId.make("node:1"),
  parentScopeId: null,
  providerThreadId: null,
  kind: "repository",
  ordinalWithinParent: 1,
  advancesAppRunCount: false,
  cwd: `/shop/${name}`,
  label: name,
  repositoryPath: `/shop/${name}`,
  relativePath: name,
  createdAt: capturedAt,
});

const checkpoint = (
  name: string,
  ordinal: number,
  runId: string | null,
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint:${name}:${ordinal}`),
  threadId,
  scopeId: CheckpointScopeId.make(`scope:${name}`),
  runId: runId === null ? null : RunId.make(runId),
  nodeId: NodeId.make("node:1"),
  parentCheckpointId: null,
  ordinalWithinScope: ordinal,
  appRunOrdinal: null,
  ref: CheckpointRef.make(`refs/t3/${name}/${ordinal}`),
  status: "ready",
  files: runId === null ? [] : [{ path: "x", kind: "modified", additions: 1, deletions: 0 }],
  capturedAt,
});

describe("threadChangedRepositories", () => {
  it("lists the repositories turns changed, most recently changed first", () => {
    expect(
      threadChangedRepositories({
        checkpointScopes: [scope("api"), scope("web"), scope("docs")],
        checkpoints: [
          checkpoint("api", 1, "run:1"),
          checkpoint("web", 1, null),
          checkpoint("web", 2, "run:2"),
          // docs only has a baseline: no turn changed it.
          checkpoint("docs", 0, null),
        ],
      }).map((repository) => repository.name),
    ).toEqual(["web", "api"]);
  });
});

describe("threadRepositorySections", () => {
  const repository = (name: string) => ({ key: `/shop/${name}`, name, cwd: `/shop/${name}` });

  it("folds repositories past the first few until shown, keeping every one listed", () => {
    const changed = ["a", "b", "c", "d"].map(repository);
    const folded = threadRepositorySections({
      changed,
      picked: [],
      threadCwd: null,
      showAll: false,
    });
    expect(folded.visible.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(folded.hidden.map((entry) => entry.name)).toEqual(["d"]);
    const shown = threadRepositorySections({
      changed,
      picked: [repository("e")],
      threadCwd: null,
      showAll: true,
    });
    expect(shown.visible.map((entry) => entry.name)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never lists the thread's own folder or a repository twice", () => {
    const sections = threadRepositorySections({
      changed: [repository("a")],
      picked: [repository("a"), { key: "/shop", name: "shop", cwd: "/shop" }],
      threadCwd: "/shop",
      showAll: false,
    });
    expect(sections.visible.map((entry) => entry.name)).toEqual(["a"]);
  });
});

describe("otherThreadRepositories", () => {
  it("offers the project's other Git repositories not listed yet", () => {
    expect(
      otherThreadRepositories({
        folders: {
          projectIsGitRepository: false,
          codeWorkspaceFile: null,
          suggestions: [],
          folders: [
            { name: "api", path: "/shop/api", state: "git", discovered: true },
            { name: "web", path: "/shop/web", state: "git", discovered: true },
            { name: "notes", path: "/notes", state: "plain", discovered: false },
          ],
        },
        listed: [{ key: "/shop/api", name: "api", cwd: "/shop/api" }],
        threadCwd: null,
      }).map((entry) => entry.name),
    ).toEqual(["web"]);
  });
});

describe("threadRepositoryFile", () => {
  const scopes = [
    { kind: "root_run" as const, cwd: "/work/app" },
    { kind: "repository" as const, cwd: "/work/app/packages", relativePath: "packages" },
    { kind: "repository" as const, cwd: "/work/app/packages/api", relativePath: "packages/api" },
    { kind: "repository" as const, cwd: "/work/lib", relativePath: "../lib" },
  ];

  it("resolves a file to the deepest repository that claims it", () => {
    expect(threadRepositoryFile(scopes, "packages/api/src/x.ts")).toEqual({
      cwd: "/work/app/packages/api",
      path: "src/x.ts",
      insideThreadFolder: true,
    });
    expect(threadRepositoryFile(scopes, "../lib/src/x.ts")).toEqual({
      cwd: "/work/lib",
      path: "src/x.ts",
      insideThreadFolder: false,
    });
  });

  it("leaves the thread's own files and unclaimed escapes alone", () => {
    expect(threadRepositoryFile(scopes, "src/main.ts")).toBeNull();
    expect(threadRepositoryFile(scopes, "../other/x.ts")).toBeNull();
    expect(threadRepositoryFile(scopes, "../lib/../../etc/passwd")).toBeNull();
  });
});
