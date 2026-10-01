import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useScratchDraftWorkspace } from "./useScratchDraftWorkspace";

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  ensure: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    mocks.effects.push(effect);
  },
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("../state/projects", () => ({ projectEnvironment: { ensureScratch: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => mocks.ensure }));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("scratch");
const draftId = DraftId.make("draft");
const threadId = ThreadId.make("thread");
const project = { id: projectId, environmentId, workspaceRoot: "/scratch" } as EnvironmentProject;
const draft = () => useComposerDraftStore.getState().getDraftSession(draftId);

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.ensure.mockReset();
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), draftId, { threadId });
});

function runEffects() {
  return mocks.effects.map((effect) => effect());
}

describe("Scratch draft workspace readiness", () => {
  it("blocks workspace actions until config and terminal metadata arrive", () => {
    expect(
      useScratchDraftWorkspace(draftId, draft(), project, undefined, false, false, false).pending,
    ).toBe(true);
    runEffects();
    expect(mocks.ensure).not.toHaveBeenCalled();
    mocks.effects.length = 0;
    expect(
      useScratchDraftWorkspace(draftId, draft(), project, "/scratch", true, false, false).pending,
    ).toBe(true);
    runEffects();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("preserves preexisting terminals until the user closes them", () => {
    const state = useScratchDraftWorkspace(draftId, draft(), project, "/scratch", true, true, true);
    expect(state).toMatchObject({ pending: true, blockedByTerminals: true });
    runEffects();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(draft()?.worktreePath).toBeNull();
  });

  it("stores the prepared folder before enabling workspace actions", async () => {
    mocks.ensure.mockResolvedValue({
      _tag: "Success",
      value: { projectId, worktreePath: "/scratch/thread-folder" },
    });
    expect(
      useScratchDraftWorkspace(draftId, draft(), project, "/scratch", true, true, false).pending,
    ).toBe(true);
    runEffects();
    await vi.waitFor(() => expect(draft()?.worktreePath).toBe("/scratch/thread-folder"));
    expect(mocks.ensure).toHaveBeenCalledWith({ environmentId, input: { threadId } });
    expect(
      useScratchDraftWorkspace(draftId, draft(), project, "/scratch", true, true, true).pending,
    ).toBe(false);
  });

  it("does not overwrite a draft retargeted while preparation was in flight", async () => {
    let finish!: (value: unknown) => void;
    mocks.ensure.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    useScratchDraftWorkspace(draftId, draft(), project, "/scratch", true, true, false);
    runEffects();
    const otherProject = ProjectId.make("other");
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(scopeProjectRef(environmentId, otherProject), draftId, {
        worktreePath: "/other",
      });
    finish({ _tag: "Success", value: { projectId, worktreePath: "/scratch/thread-folder" } });
    await Promise.resolve();
    expect(draft()?.worktreePath).toBe("/other");
  });
});
