import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { createPullRequestDraft } from "./usePullRequestHandoff";
import { preparePullRequestDraft } from "./usePullRequestDraftWorkspace";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const input = {
  environmentId,
  projectId,
  cwd: "/repo",
  reference: "https://github.com/owner/repo/pull/42",
};
const checkout = { branch: "fix", worktreePath: "/worktrees/fix" };
const store = () => useComposerDraftStore.getState();
function restore() {
  const options = useComposerDraftStore.persist.getOptions();
  const serialized = JSON.stringify(options.partialize!(store()));
  useComposerDraftStore.setState(
    options.merge!(JSON.parse(serialized), useComposerDraftStore.getInitialState()),
    true,
  );
}
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
  it("opens immediately and preserves text typed while preparation is pending", async () => {
    const draftId = createPullRequestDraft(input);
    let finish!: (value: typeof checkout) => void;
    const prepare = vi.fn(
      () =>
        new Promise<typeof checkout>((resolve) => {
          finish = resolve;
        }),
    );
    const operation = preparePullRequestDraft(draftId, prepare);
    expect(store().getDraftSession(draftId)).toMatchObject({
      environmentId,
      projectId,
      worktreePath: null,
      pullRequestReference: input.reference,
      envMode: "worktree",
    });
    expect(store().getComposerDraft(draftId)?.prompt).toBe(input.reference);
    store().setPrompt(draftId, "My review instructions typed while loading");
    finish(checkout);
    await operation;
    expect(store().getDraftSession(draftId)).toMatchObject({
      ...checkout,
      pullRequestReference: null,
      envMode: "worktree",
      startFromOrigin: false,
    });
    expect(store().getComposerDraft(draftId)?.prompt).toBe(
      "My review instructions typed while loading",
    );
    expect(prepare).toHaveBeenCalledOnce();
  });
  it("joins an in-flight preparation when a route remounts", async () => {
    const draftId = createPullRequestDraft(input);
    let finish!: (value: typeof checkout) => void;
    const prepare = vi.fn(
      () =>
        new Promise<typeof checkout>((resolve) => {
          finish = resolve;
        }),
    );
    const first = preparePullRequestDraft(draftId, prepare);
    const second = preparePullRequestDraft(draftId, prepare);
    expect(second).toBe(first);
    finish(checkout);
    await second;
    expect(prepare).toHaveBeenCalledOnce();
  });
  it("keeps the prompt and PR target after failure and retries the same draft", async () => {
    const draftId = createPullRequestDraft(input);
    store().setPrompt(draftId, "Keep these instructions");
    await expect(
      preparePullRequestDraft(draftId, async () => {
        throw new Error("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBe(input.reference);
    expect(store().getComposerDraft(draftId)?.prompt).toBe("Keep these instructions");
    restore();
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBe(input.reference);
    await preparePullRequestDraft(draftId, async () => checkout);
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBeNull();
    expect(store().getComposerDraft(draftId)?.prompt).toBe("Keep these instructions");
  });
  it("does not unlock Send when the server did not return a worktree", async () => {
    const draftId = createPullRequestDraft(input);
    await expect(
      preparePullRequestDraft(draftId, async () => ({ branch: "fix", worktreePath: null })),
    ).rejects.toThrow("worktree could not be prepared");
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBe(input.reference);
  });
  it("does not resurrect a discarded draft when preparation finishes", async () => {
    const draftId = createPullRequestDraft(input);
    let finish!: (value: typeof checkout) => void;
    const pending = preparePullRequestDraft(
      draftId,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    store().clearDraftThread(draftId);
    finish(checkout);
    await pending;
    expect(store().getDraftSession(draftId)).toBeNull();
  });
  it("does not apply a late result after the draft changes projects", async () => {
    const draftId = createPullRequestDraft(input);
    let finish!: (value: typeof checkout) => void;
    const pending = preparePullRequestDraft(
      draftId,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    store().setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(environmentId, ProjectId.make("other")),
    });
    finish(checkout);
    await pending;
    expect(store().getDraftSession(draftId)?.worktreePath).toBeNull();
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBeNull();
  });
  it("preserves unrelated drafts and independent reviews sharing a worktree", async () => {
    const unrelated = DraftId.make("unrelated");
    store().setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), unrelated);
    store().setPrompt(unrelated, "Unrelated work");
    const first = createPullRequestDraft(input);
    const second = createPullRequestDraft(input);
    store().setPrompt(first, "First review");
    await preparePullRequestDraft(second, async () => checkout);
    await preparePullRequestDraft(first, async () => checkout);
    expect(first).not.toBe(second);
    expect(store().getDraftSession(first)?.threadId).not.toBe(
      store().getDraftSession(second)?.threadId,
    );
    expect(store().getComposerDraft(first)?.prompt).toBe("First review");
    expect(store().getComposerDraft(second)?.prompt).toBe(input.reference);
    expect(store().getComposerDraft(unrelated)?.prompt).toBe("Unrelated work");
  });
  it("restores both pending and prepared reviews without losing typed content", async () => {
    const draftId = createPullRequestDraft(input);
    store().setPrompt(draftId, "Review cancellation handling");
    restore();
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBe(input.reference);
    await preparePullRequestDraft(draftId, async () => checkout);
    restore();
    expect(store().getDraftSession(draftId)).toMatchObject({
      ...checkout,
      pullRequestReference: null,
    });
    expect(store().getComposerDraft(draftId)?.prompt).toBe("Review cancellation handling");
  });
});
