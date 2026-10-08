import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DraftId, type DraftThreadState } from "../composerDraftStore";
import { makeTestThread } from "../test/threadFixtures";
import { useReviewThread } from "./useReviewThread";

const state = vi.hoisted(() => ({
  draft: null as unknown,
  server: null as unknown,
  useThread: vi.fn(),
}));
vi.mock("../composerDraftStore", async (original) => ({
  ...(await original<typeof import("../composerDraftStore")>()),
  useComposerDraftStore: (selector: (store: unknown) => unknown) =>
    selector({
      getDraftSession: () => state.draft,
      getDraftThreadByRef: (ref: ScopedThreadRef) => {
        const draft = state.draft as DraftThreadState | null;
        return draft?.threadId === ref.threadId && draft.environmentId === ref.environmentId
          ? draft
          : null;
      },
    }),
}));
vi.mock("../state/entities", () => ({
  useThread: (...args: unknown[]) => {
    state.useThread(...args);
    return state.server;
  },
}));
const environmentId = EnvironmentId.make("review-local");
const threadId = ThreadId.make("review-new-thread");
const draft: DraftThreadState = {
  environmentId,
  threadId,
  projectId: ProjectId.make("review-project"),
  logicalProjectKey: "repo",
  createdAt: "2026-10-08T00:00:00.000Z",
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/work",
  worktreePath: "/repo/worktree",
  envMode: "worktree",
  startFromOrigin: false,
};
let renderer: ReactTestRenderer | null = null;
let value: ReturnType<typeof useReviewThread>;
function Probe(props: { refOverride?: ScopedThreadRef | undefined }) {
  const result = useReviewThread(props.refOverride ?? null, DraftId.make("draft-review"));
  useEffect(() => {
    value = result;
  }, [result]);
  return null;
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  state.useThread.mockReset();
  state.server = null;
  state.draft = null;
});
function render(refOverride?: ScopedThreadRef) {
  act(() => {
    if (renderer) renderer.update(<Probe refOverride={refOverride} />);
    else renderer = create(<Probe refOverride={refOverride} />);
  });
}
describe("draft Git review", () => {
  it("resolves the selected draft worktree before first Send, then uses the promoted server thread", () => {
    state.draft = draft;
    render();
    expect(value.threadRef).toEqual(scopeThreadRef(environmentId, threadId));
    expect(value.thread?.environmentId).toBe(environmentId);
    expect(value.thread?.projectId).toBe(draft.projectId);
    expect(value.thread?.worktreePath).toBe("/repo/worktree");
    expect(state.useThread).toHaveBeenLastCalledWith(value.threadRef, { waitForShell: true });
    const promoted = makeTestThread({
      environmentId,
      id: threadId,
      projectId: draft.projectId,
      worktreePath: "/repo/created-worktree",
    });
    state.server = promoted;
    render();
    expect(value.thread).toBe(promoted);
    expect(value.thread?.worktreePath).toBe("/repo/created-worktree");
  });
  it("resolves project workspace metadata for a local draft without inventing a worktree", () => {
    state.draft = { ...draft, envMode: "local", worktreePath: null };
    render();
    expect(value.thread?.projectId).toBe(draft.projectId);
    expect(value.thread?.worktreePath).toBeNull();
  });
  it("does not use an unrelated draft for an explicit server conversation", () => {
    state.draft = draft;
    const explicit = scopeThreadRef(environmentId, ThreadId.make("another-thread"));
    render(explicit);
    expect(value.threadRef).toEqual(explicit);
    expect(value.thread).toBeNull();
  });
});
