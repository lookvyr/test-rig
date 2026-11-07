import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  attachPullRequestTask,
  attachPullRequestDiscussion,
  createPullRequestDraft,
} from "./usePullRequestHandoff";
import {
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
} from "../components/pullRequest/pullRequestDetail.logic";
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
  it("adds the whole attributed discussion from a reply and keeps the existing prompt and attachments", () => {
    const target = { environmentId, threadId: ThreadId.make("discussion") };
    const author = { login: "alice", name: null, avatarUrl: null };
    const root = {
      id: "root",
      author,
      body: "Is this safe?",
      createdAt: "2026-01-01T00:00:00Z",
      url: null,
    };
    const reply = {
      ...root,
      id: "reply",
      author: { ...author, login: "bob" },
      body: "Covered by a regression test.",
    };
    const thread = {
      id: "t1",
      path: "src/queue.ts",
      line: 8,
      side: "left" as const,
      isResolved: true,
      isOutdated: false,
      comments: [root, reply],
    };
    const pr = {
      url: input.reference,
      number: 42,
      title: "Queue",
      headBranch: "fix",
      baseBranch: "main",
      state: "open" as const,
      isDraft: false,
      reviewThreads: [thread],
    };
    store().setPrompt(target, "Compare with the previous patch.");
    const { pullRequest: _metadata, ...other } =
      buildAskAboutPullRequestHandoff(pr).reviewComments[0]!;
    const otherContext = { ...other, id: "my-other-context" };
    store().setReviewComments(target, [otherContext]);
    const subject = {
      kind: "comment" as const,
      comment: { ...reply, kind: "review-comment" as const, path: thread.path, reviewState: null },
    };
    expect(attachPullRequestDiscussion(target, pr, subject)).toBe(true);
    expect(attachPullRequestDiscussion(target, pr, { kind: "thread", thread })).toBe(true);
    expect(store().getComposerDraft(target)).toMatchObject({
      prompt: "Compare with the previous patch.",
      reviewComments: [
        otherContext,
        { pullRequest: { url: pr.url } },
        {
          id: `pr-comment:${pr.url}:thread:t1`,
          filePath: "src/queue.ts",
          rangeLabel: "L8 (before)",
          text: "alice: Is this safe?\nbob: Covered by a regression test.",
        },
      ],
    });
    const general = {
      ...subject.comment,
      id: "general",
      kind: "issue-comment" as const,
      path: null,
      body: "Ship it.",
    };
    expect(attachPullRequestDiscussion(target, pr, { kind: "comment", comment: general })).toBe(
      true,
    );
    expect(store().getComposerDraft(target)?.reviewComments.at(-1)).toMatchObject({
      id: `pr-comment:${pr.url}:comment:general`,
      filePath: "@bob",
      text: "bob: Ship it.",
    });
    expect(
      attachPullRequestDiscussion(target, pr, {
        kind: "comment",
        comment: { ...general, body: "<!-- hidden -->" },
      }),
    ).toBe(false);
    expect(store().getComposerDraft(target)?.reviewComments).toHaveLength(4);
  });
  it("lets a project question use PR context without preparing a checkout", () => {
    const draftId = createPullRequestDraft(input, "question");
    expect(store().getDraftSession(draftId)?.pullRequestReference).toBeNull();
  });
  it("writes follow-ups to the open thread and preserves its unrelated work", () => {
    const target = { environmentId, threadId: ThreadId.make("active") };
    const pr = {
      number: 42,
      title: "Change",
      url: input.reference,
      headBranch: "fix",
      baseBranch: "main",
      state: "open" as const,
      isDraft: false,
    };
    const explain = buildExplainPullRequestHandoff(pr);
    const unrelated = { ...explain.reviewComments[0]!, id: "local-file-feedback" };
    store().setPrompt(target, "My notes");
    store().setReviewComments(target, [unrelated]);
    attachPullRequestTask(target, explain);
    expect(store().getComposerDraft(target)?.prompt).toBe(`My notes

${explain.prompt}`);
    const ask = buildAskAboutPullRequestHandoff(pr);
    attachPullRequestTask(target, ask, explain.prompt);
    expect(store().getComposerDraft(target)).toMatchObject({
      prompt: "My notes",
      reviewComments: [unrelated, ...ask.reviewComments],
    });
    expect(store().listDraftThreadKeys()).toEqual([]);
  });

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
