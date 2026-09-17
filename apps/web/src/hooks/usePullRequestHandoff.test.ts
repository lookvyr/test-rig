import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { preparePullRequestDraft } from "./usePullRequestHandoff";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const input = {
  environmentId,
  projectId,
  cwd: "/repo",
  reference: "https://github.com/owner/repo/pull/42",
};

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
});

describe("PR review draft", () => {
  it("waits for preparation, then creates a URL-only draft with the prepared checkout", async () => {
    let finish!: (result: { branch: string; worktreePath: string }) => void;
    const prepare = vi.fn<Parameters<typeof preparePullRequestDraft>[1]>(
      () =>
        new Promise<{ branch: string; worktreePath: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const operation = preparePullRequestDraft(input, prepare);
    expect(useComposerDraftStore.getState().draftThreadsByThreadKey).toEqual({});
    expect(useComposerDraftStore.getState().draftsByThreadKey).toEqual({});
    finish({ branch: "fix", worktreePath: "/worktrees/fix" });
    const draftId = await operation;
    const composer = useComposerDraftStore.getState();
    expect(prepare).toHaveBeenCalledOnce();
    expect(composer.getDraftSession(draftId)).toMatchObject({
      environmentId,
      projectId,
      threadId: prepare.mock.calls[0]![0],
      branch: "fix",
      worktreePath: "/worktrees/fix",
      envMode: "worktree",
      startFromOrigin: false,
    });
    expect(composer.getComposerDraft(draftId)?.prompt).toBe(input.reference);
  });

  it("preserves unrelated project drafts when starting a review", async () => {
    const composer = useComposerDraftStore.getState();
    const unrelated = DraftId.make("unrelated");
    composer.setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), unrelated);
    composer.setPrompt(unrelated, "Keep my unrelated work");
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const review = await preparePullRequestDraft(input, prepare);
    expect(review).not.toBe(unrelated);
    expect(composer.getComposerDraft(unrelated)?.prompt).toBe("Keep my unrelated work");
    expect(composer.getDraftSession(unrelated)).not.toBeNull();
  });

  it("creates no draft or composer content when checkout preparation fails", async () => {
    await expect(
      preparePullRequestDraft(input, async () => {
        throw new Error("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
    expect(useComposerDraftStore.getState().draftThreadsByThreadKey).toEqual({});
    expect(useComposerDraftStore.getState().draftsByThreadKey).toEqual({});
  });

  it("keeps independent unsent drafts when the same PR worktree is reused", async () => {
    const prepare = vi.fn().mockResolvedValue({ branch: "fix", worktreePath: "/worktrees/fix" });
    const first = await preparePullRequestDraft(input, prepare);
    useComposerDraftStore.getState().setPrompt(first, "Keep my unsent PR review");
    const next = await preparePullRequestDraft(input, prepare);
    const composer = useComposerDraftStore.getState();
    expect(next).not.toBe(first);
    expect(composer.getDraftSession(next)?.threadId).not.toBe(
      composer.getDraftSession(first)?.threadId,
    );
    expect(composer.getDraftSession(next)?.worktreePath).toBe(
      composer.getDraftSession(first)?.worktreePath,
    );
    expect(composer.getComposerDraft(first)?.prompt).toBe("Keep my unsent PR review");
    expect(composer.getComposerDraft(next)?.prompt).toBe(input.reference);
  });

  it("restores an unsent review and checkout through normal draft persistence", async () => {
    const draftId = await preparePullRequestDraft(input, async () => ({
      branch: "fix",
      worktreePath: "/worktrees/fix",
    }));
    const composer = useComposerDraftStore.getState();
    const prompt = `${input.reference}\n\nReview cancellation handling.`;
    composer.setPrompt(draftId, prompt);
    const options = useComposerDraftStore.persist.getOptions();
    const serialized = JSON.stringify(options.partialize!(useComposerDraftStore.getState()));
    useComposerDraftStore.setState(
      options.merge!(JSON.parse(serialized), useComposerDraftStore.getInitialState()),
      true,
    );
    expect(useComposerDraftStore.getState().getDraftSession(draftId)).toMatchObject({
      environmentId,
      projectId,
      branch: "fix",
      worktreePath: "/worktrees/fix",
    });
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt).toBe(prompt);
  });

  it("keeps overlapping preparations separate when they finish out of order", async () => {
    let finishFirst!: (result: { branch: string; worktreePath: string }) => void;
    const firstPending = preparePullRequestDraft(
      input,
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const secondInput = { ...input, reference: "https://github.com/owner/repo/pull/43" };
    const second = await preparePullRequestDraft(secondInput, async () => ({
      branch: "second",
      worktreePath: "/worktrees/second",
    }));
    useComposerDraftStore.getState().setPrompt(second, "Keep the second review draft");
    finishFirst({ branch: "first", worktreePath: "/worktrees/first" });
    const first = await firstPending;
    const composer = useComposerDraftStore.getState();
    expect(first).not.toBe(second);
    expect(composer.getComposerDraft(first)?.prompt).toBe(input.reference);
    expect(composer.getDraftSession(first)?.worktreePath).toBe("/worktrees/first");
    expect(composer.getComposerDraft(second)?.prompt).toBe("Keep the second review draft");
    expect(composer.getDraftSession(second)?.worktreePath).toBe("/worktrees/second");
  });
});
