import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { createMemoryStorage } from "../lib/storage";
import {
  createPullRequestWorkspaceStore,
  pullRequestWorkspaceKey,
} from "../pullRequestWorkspaceStore";
import {
  appendPullRequestHandoffContext,
  buildPullRequestFeedbackContext,
  buildPullRequestHandoffContext,
  preparePullRequestHandoff,
  resolveLinkedPullRequestTarget,
} from "./usePullRequestHandoff";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const input = {
  environmentId,
  projectId,
  cwd: "/repo",
  pullRequest: {
    url: "https://github.com/owner/repo/pull/42",
    number: 42,
    title: "Fix resource release",
    headRefName: "fix",
    baseRefName: "main",
    headSha: "new-head",
    body: "Release the handle.",
  },
};
const scope = { environmentId, cwd: input.cwd, reference: input.pullRequest.url };

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
});

describe("explicit PR draft handoff", () => {
  it("appends to a linked conversation without preparing a worktree, preserves composer data, and deduplicates repeated handoffs", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const ref = scopeThreadRef(environmentId, ThreadId.make("existing"));
    store.getState().link(scope, { ...ref, projectId });
    store.getState().setInstructions(scope, "Check cancellation");
    const composer = useComposerDraftStore.getState();
    composer.setPrompt(ref, "My unsent question");
    composer.setModelSelection(ref, {
      model: "gpt-5.4",
      options: [],
      instanceId: ProviderInstanceId.make("codex"),
    });
    const attachment = {
      id: "attachment",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 2,
      dataUrl: "data:image/png;base64,AA==",
    };
    const draft = composer.getComposerDraft(ref)!;
    useComposerDraftStore.setState((state) => ({
      draftsByThreadKey: Object.fromEntries(
        Object.entries(state.draftsByThreadKey).map(([key, value]) => [
          key,
          value === draft ? { ...value, persistedAttachments: [attachment] } : value,
        ]),
      ),
    }));
    const before = composer.getComposerDraft(ref)!;
    const prepare = vi.fn();
    const deps = () => ({
      prepare,
      readThread: () => ({
        environmentId,
        id: ref.threadId,
        projectId,
        archivedAt: null,
        sideOfThreadId: null,
      }),
      getWorkspaces: store.getState,
    });
    await preparePullRequestHandoff(input, { kind: "existing", threadId: ref.threadId }, deps());
    const firstPrompt = composer.getComposerDraft(ref)?.prompt;
    await preparePullRequestHandoff(input, { kind: "existing", threadId: ref.threadId }, deps());
    const after = composer.getComposerDraft(ref)!;
    expect(prepare).not.toHaveBeenCalled();
    expect(after.prompt).toBe(firstPrompt);
    expect(after.prompt).toMatch(/^My unsent question\n\nPull request #42/);
    expect(after.persistedAttachments).toEqual(before.persistedAttachments);
    expect(after.modelSelectionByProvider).toEqual(before.modelSelectionByProvider);
    expect(Object.keys(useComposerDraftStore.getState().draftThreadsByThreadKey)).toHaveLength(0);
  });

  it("creates only a local draft after prepare, preserves unrelated project drafts, and reopens it without preparing again", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const composer = useComposerDraftStore.getState();
    const unrelated = DraftId.make("unrelated");
    composer.setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), unrelated);
    composer.setPrompt(unrelated, "Keep my unrelated work");
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const first = await preparePullRequestHandoff(
      input,
      { kind: "new" },
      {
        prepare,
        readThread: () => null,
        getWorkspaces: store.getState,
      },
    );
    expect(first.draftId).toBeTruthy();
    expect(composer.getDraftSession(first.draftId!)?.worktreePath).toBe("/worktrees/fix");
    expect(composer.getComposerDraft(unrelated)?.prompt).toBe("Keep my unrelated work");
    const again = resolveLinkedPullRequestTarget(input, {
      readThread: () => null,
      getWorkspaces: store.getState,
    });
    expect(again).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("preserves notes/instructions and creates no draft when preparation fails", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    store.getState().setInstructions(scope, "Keep these instructions");
    store.getState().addNote(scope, { body: "My note", headSha: "old-head" });
    const before = store.getState().entriesByKey[pullRequestWorkspaceKey(scope)];
    await expect(
      preparePullRequestHandoff(
        input,
        { kind: "new" },
        {
          prepare: async () => {
            throw new Error("fetch failed");
          },
          readThread: () => null,
          getWorkspaces: store.getState,
        },
      ),
    ).rejects.toThrow("fetch failed");
    expect(store.getState().entriesByKey[pullRequestWorkspaceKey(scope)]).toEqual(before);
    expect(useComposerDraftStore.getState().draftThreadsByThreadKey).toEqual({});
  });

  it("marks selected old-head notes stale and omits unselected notes", () => {
    const context = buildPullRequestHandoffContext(input.pullRequest, {
      instructions: "Review",
      notes: [
        {
          id: "one",
          body: "Old location",
          headSha: "old-head",
          filePath: "src/main.ts",
          line: 2,
          side: "old",
          selected: true,
        },
        { id: "two", body: "Excluded", headSha: "new-head", selected: false },
      ],
    });
    expect(context).toContain("src/main.ts:2 (old) [STALE: written against old-head");
    expect(context).not.toContain("Excluded");
  });
  it("shares preparation across remounts and includes notes edited while it was pending", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    let resolvePreparation!: (value: { branch: string; worktreePath: string }) => void;
    const preparation = new Promise<{ branch: string; worktreePath: string }>((resolve) => {
      resolvePreparation = resolve;
    });
    const prepare = vi.fn(() => preparation);
    const dependencies = { prepare, readThread: () => null, getWorkspaces: store.getState };
    const first = preparePullRequestHandoff(input, { kind: "new" }, dependencies);
    const second = preparePullRequestHandoff(input, { kind: "new" }, dependencies);
    expect(second).toBe(first);
    await expect(
      preparePullRequestHandoff(
        input,
        { kind: "existing", threadId: ThreadId.make("other") },
        dependencies,
      ),
    ).rejects.toThrow("already being prepared");
    store.getState().setInstructions(scope, "Edited during preparation");
    resolvePreparation({ branch: "fix", worktreePath: "/worktrees/fix" });
    const target = await first;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(useComposerDraftStore.getState().getComposerDraft(target.draftId!)?.prompt).toContain(
      "Edited during preparation",
    );
  });

  it("keeps a linked draft while its promotion shell is still arriving", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const dependencies = { prepare, readThread: () => null, getWorkspaces: store.getState };
    const target = await preparePullRequestHandoff(input, { kind: "new" }, dependencies);
    useComposerDraftStore
      .getState()
      .markDraftThreadPromoting(target.draftId!, scopeThreadRef(environmentId, target.threadId));
    const reopened = resolveLinkedPullRequestTarget(input, dependencies);
    expect(reopened).toEqual(target);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("preserves an old unsent PR draft when the user explicitly chooses a new worktree", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const dependencies = { prepare, readThread: () => null, getWorkspaces: store.getState };
    const first = await preparePullRequestHandoff(input, { kind: "new" }, dependencies);
    useComposerDraftStore.getState().setPrompt(first.draftId!, "Keep my unsent PR draft");
    const next = await preparePullRequestHandoff(input, { kind: "new" }, dependencies);
    expect(next.draftId).not.toBe(first.draftId);
    expect(useComposerDraftStore.getState().getComposerDraft(first.draftId!)?.prompt).toBe(
      "Keep my unsent PR draft",
    );
  });
  it("reopens the same PR draft with unsent edits after serializing and hydrating both stores", async () => {
    const storage = createMemoryStorage();
    const store = createPullRequestWorkspaceStore(storage);
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const target = await preparePullRequestHandoff(
      input,
      { kind: "new" },
      {
        prepare,
        readThread: () => null,
        getWorkspaces: store.getState,
      },
    );
    const composer = useComposerDraftStore.getState();
    const ordinaryDraft = DraftId.make("ordinary-project-draft");
    composer.setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), ordinaryDraft);
    composer.setPrompt(ordinaryDraft, "Unrelated unsent text");
    const originalPrompt =
      composer.getComposerDraft(target.draftId!)!.prompt + "\n\nMy additional unsent question";
    composer.setPrompt(target.draftId!, originalPrompt);
    const options = useComposerDraftStore.persist.getOptions();
    const serialized = JSON.stringify(options.partialize!(useComposerDraftStore.getState()));
    useComposerDraftStore.setState(
      options.merge!(JSON.parse(serialized), useComposerDraftStore.getInitialState()),
      true,
    );
    const hydratedDraft = useComposerDraftStore.getState().getDraftSession(target.draftId!);
    expect(hydratedDraft).toMatchObject({
      environmentId,
      projectId,
      threadId: target.threadId,
      branch: "fix",
      worktreePath: "/worktrees/fix",
    });
    expect(useComposerDraftStore.getState().getComposerDraft(ordinaryDraft)?.prompt).toBe(
      "Unrelated unsent text",
    );
    const restored = createPullRequestWorkspaceStore(storage);
    const reopened = resolveLinkedPullRequestTarget(input, {
      readThread: () => null,
      getWorkspaces: restored.getState,
    });
    expect(reopened).toEqual(target);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(useComposerDraftStore.getState().getComposerDraft(target.draftId!)?.prompt).toBe(
      originalPrompt,
    );
  });
  it("opening a saved conversation leaves its composer, instructions and association untouched", () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    const threadId = ThreadId.make("linked");
    const ref = scopeThreadRef(environmentId, threadId);
    store.getState().link(scope, { ...ref, projectId });
    store.getState().setInstructions(scope, "New instructions that have not been handed off");
    useComposerDraftStore.getState().setPrompt(ref, "My unsent question");
    const before = store.getState().entriesByKey;
    const target = resolveLinkedPullRequestTarget(input, {
      readThread: () => ({
        environmentId,
        id: threadId,
        projectId,
        archivedAt: null,
      }),
      getWorkspaces: store.getState,
    });
    expect(target).toEqual({ ...ref, projectId });
    expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe(
      "My unsent question",
    );
    expect(store.getState().entriesByKey).toBe(before);
  });

  it.each(["missing", "archived", "side", "other-project", "other-environment"])(
    "rejects an unavailable %s destination without replacing its link or creating a worktree",
    async (kind) => {
      const store = createPullRequestWorkspaceStore(createMemoryStorage());
      const threadId = ThreadId.make("existing");
      store.getState().link(scope, { environmentId, projectId, threadId });
      store.getState().setInstructions(scope, "Keep my instructions");
      const before = store.getState().entriesByKey;
      const readThread = () =>
        kind === "missing"
          ? null
          : {
              environmentId:
                kind === "other-environment" ? EnvironmentId.make("remote") : environmentId,
              id: threadId,
              projectId: kind === "other-project" ? ProjectId.make("different") : projectId,
              archivedAt: kind === "archived" ? "2026-09-04T00:00:00Z" : null,
              sideOfThreadId: kind === "side" ? ThreadId.make("parent") : null,
            };
      const prepare = vi.fn();
      const dependencies = { prepare, readThread, getWorkspaces: store.getState };
      await expect(
        preparePullRequestHandoff(input, { kind: "existing", threadId }, dependencies),
      ).rejects.toThrow("unavailable");
      expect(() => resolveLinkedPullRequestTarget(input, dependencies)).toThrow("unavailable");
      expect(prepare).not.toHaveBeenCalled();
      expect(store.getState().entriesByKey).toBe(before);
      expect(useComposerDraftStore.getState().draftThreadsByThreadKey).toEqual({});
    },
  );

  it("preserves the old association until explicit replacement worktree preparation succeeds", async () => {
    const store = createPullRequestWorkspaceStore(createMemoryStorage());
    store.getState().link(scope, { environmentId, projectId, threadId: ThreadId.make("previous") });
    const before = store.getState().entriesByKey;
    let finish!: (value: { branch: string; worktreePath: string }) => void;
    const preparation = new Promise<{ branch: string; worktreePath: string }>((resolve) => {
      finish = resolve;
    });
    const operation = preparePullRequestHandoff(
      input,
      { kind: "new" },
      { prepare: () => preparation, readThread: () => null, getWorkspaces: store.getState },
    );
    expect(store.getState().entriesByKey).toBe(before);
    finish({ branch: "fix", worktreePath: "/worktrees/fix" });
    const target = await operation;
    expect(store.getState().entriesByKey[pullRequestWorkspaceKey(scope)]?.linkedTarget).toEqual(
      target,
    );
  });

  it("keeps feedback compact, includes stale coordinates, and appends once without touching initial instructions", () => {
    const notes = [
      {
        id: "selected",
        body: "Check cancellation",
        headSha: "old-head",
        selected: true,
        filePath: "src/main.ts",
        line: 2,
        side: "old" as const,
      },
      { id: "excluded", body: "Leave out", headSha: "new-head", selected: false },
    ];
    const context = buildPullRequestFeedbackContext(input.pullRequest, notes);
    expect(context).toContain("Head commit: new-head");
    expect(context).toContain("src/main.ts:2 (old) [STALE: written against old-head");
    expect(context).not.toContain(input.pullRequest.body);
    expect(context).not.toContain("Instructions:");
    expect(context).not.toContain("Leave out");
    const draftId = DraftId.make("current");
    useComposerDraftStore.getState().setPrompt(draftId, "My own message");
    expect(appendPullRequestHandoffContext(draftId, context)).toBe(true);
    expect(appendPullRequestHandoffContext(draftId, context)).toBe(false);
    expect(buildPullRequestFeedbackContext(input.pullRequest, [])).toBe("");
    expect(appendPullRequestHandoffContext(draftId, "")).toBe(false);
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt).toBe(
      `My own message\n\n${context}`,
    );
  });
});
