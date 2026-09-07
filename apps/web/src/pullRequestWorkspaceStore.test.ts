import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { createMemoryStorage } from "./lib/storage";
import {
  createPullRequestWorkspaceStore,
  findPullRequestWorkspaceForThread,
  isPullRequestNoteStale,
  pullRequestWorkspaceKey,
  PULL_REQUEST_WORKSPACE_STORAGE_KEY,
} from "./pullRequestWorkspaceStore";

const scope = {
  environmentId: EnvironmentId.make("local"),
  cwd: "/repos/app",
  reference: "https://github.com/owner/repo/pull/42",
};

describe("pull request workspace persistence", () => {
  it("restores notes, instructions, selection and linkage across restart without crossing environments or repositories", () => {
    const storage = createMemoryStorage();
    const store = createPullRequestWorkspaceStore(storage);
    const foreign = { ...scope, environmentId: EnvironmentId.make("remote") };
    const otherRepo = {
      ...scope,
      cwd: "/repos/other",
      reference: "https://github.com/owner/other/pull/42",
    };
    store.getState().setInstructions(scope, "Focus on cancellation");
    store.getState().setNoteDraft(scope, {
      body: "Partially typed note",
      headSha: "old-head",
      filePath: "src/main.ts",
      line: 7,
      side: "new",
    });
    store.getState().addNote(scope, {
      body: "Unreleased resource",
      headSha: "old-head",
      filePath: "src/main.ts",
      line: 12,
      side: "new",
    });
    store.getState().setSelectedFile(scope, "src/main.ts");
    store.getState().setTab(scope, "code");
    store.getState().link(scope, {
      environmentId: scope.environmentId,
      projectId: ProjectId.make("app"),
      threadId: ThreadId.make("thread"),
    });
    store.getState().setInstructions(foreign, "Remote instructions");
    store.getState().setInstructions(otherRepo, "Other repository");
    const restored = createPullRequestWorkspaceStore(storage).getState();
    const entry = restored.entriesByKey[pullRequestWorkspaceKey(scope)]!;
    expect(entry.instructions).toBe("Focus on cancellation");
    expect(entry.noteDraft).toMatchObject({
      body: "Partially typed note",
      headSha: "old-head",
      line: 7,
    });
    expect(entry.selectedFilePath).toBe("src/main.ts");
    expect(entry.tab).toBe("code");
    expect(entry.notes[0]).toMatchObject({
      filePath: "src/main.ts",
      line: 12,
      side: "new",
      selected: true,
      headSha: "old-head",
    });
    expect(restored.entriesByKey[pullRequestWorkspaceKey(foreign)]?.instructions).toBe(
      "Remote instructions",
    );
    expect(restored.entriesByKey[pullRequestWorkspaceKey(otherRepo)]?.instructions).toBe(
      "Other repository",
    );
    expect(
      findPullRequestWorkspaceForThread(restored.entriesByKey, {
        environmentId: scope.environmentId,
        threadId: ThreadId.make("thread"),
      }),
    ).toEqual(entry);
    expect(
      findPullRequestWorkspaceForThread(restored.entriesByKey, {
        environmentId: foreign.environmentId,
        threadId: ThreadId.make("thread"),
      }),
    ).toBeNull();
    expect(isPullRequestNoteStale(entry.notes[0]!, "new-head")).toBe(true);
    expect(entry.notes[0]?.headSha).toBe("old-head");
  });

  it("resolves an explicitly selected PR before a newer association without mutating either link", () => {
    const storage = createMemoryStorage();
    const store = createPullRequestWorkspaceStore(storage);
    const other = { ...scope, reference: "https://github.com/owner/repo/pull/43" };
    const target = {
      environmentId: scope.environmentId,
      projectId: ProjectId.make("app"),
      threadId: ThreadId.make("thread"),
    };
    store.getState().link(scope, target);
    store.getState().link(other, target);
    const keyA = pullRequestWorkspaceKey(scope);
    const keyB = pullRequestWorkspaceKey(other);
    const restored = createPullRequestWorkspaceStore(storage).getState().entriesByKey;
    const entries = {
      ...restored,
      [keyA]: { ...restored[keyA]!, linkedAt: 1 },
      [keyB]: { ...restored[keyB]!, linkedAt: 2 },
    };
    const before = structuredClone(entries);
    expect(findPullRequestWorkspaceForThread(entries, target)).toBe(entries[keyB]);
    expect(findPullRequestWorkspaceForThread(entries, target, keyA)).toBe(entries[keyA]);
    expect(entries).toEqual(before);
    expect(entries[keyA]?.linkedTarget).toEqual(target);
    expect(entries[keyB]?.linkedTarget).toEqual(target);
  });

  it("does not fall back to a different PR when an explicit key is missing or linked elsewhere", () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const target = {
      environmentId: scope.environmentId,
      projectId: ProjectId.make("app"),
      threadId: ThreadId.make("thread"),
    };
    store.getState().link(scope, target);
    const entries = store.getState().entriesByKey;
    const key = pullRequestWorkspaceKey(scope);
    expect(findPullRequestWorkspaceForThread(entries, target, "missing")).toBeNull();
    expect(
      findPullRequestWorkspaceForThread(
        entries,
        { ...target, threadId: ThreadId.make("different") },
        key,
      ),
    ).toBeNull();
    expect(
      findPullRequestWorkspaceForThread(
        entries,
        { ...target, environmentId: EnvironmentId.make("remote") },
        key,
      ),
    ).toBeNull();
  });

  it("uses one canonical PR key for URL variants", () => {
    expect(
      pullRequestWorkspaceKey({
        ...scope,
        reference: "https://GITHUB.com/OWNER/REPO/pull/42/files#diff-abc",
      }),
    ).toBe(pullRequestWorkspaceKey(scope));
  });

  it("ignores malformed persisted state", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      PULL_REQUEST_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { entriesByKey: { invalid: { notes: null } } } }),
    );
    expect(createPullRequestWorkspaceStore(storage).getState().entriesByKey).toEqual({});
  });
});
