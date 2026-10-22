import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn().mockResolvedValue(undefined),
  readThreadShell: vi.fn(),
  readProject: vi.fn(),
  configs: new Map(),
  file: vi.fn(),
  matches: [] as Array<{ params: object }>,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ defaultThreadEnvMode: "local", newWorktreesStartFromOrigin: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: mocks.matches }, navigate: mocks.navigate }),
  useParams: vi.fn(),
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({ readT3ProjectFile: mocks.file }));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => mocks.configs },
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: {},
}));
vi.mock("../state/entities", () => ({
  readProject: mocks.readProject,
  readThreadShell: mocks.readThreadShell,
  useProjects: vi.fn(),
  useThread: vi.fn(),
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "scratch-key",
  getProjectOrderKey: vi.fn(),
  selectProjectGroupingSettings: vi.fn(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: vi.fn() }));

const projectRef = scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("scratch"));
beforeEach(() => {
  mocks.readThreadShell.mockReturnValue(null);
  mocks.readProject.mockReturnValue({
    id: "scratch",
    environmentId: "local",
    workspaceRoot: "/scratch",
  });
  mocks.configs.clear();
  mocks.configs.set("local", {
    scratchWorkspaceRoot: "/scratch",
    settings: DEFAULT_SERVER_SETTINGS,
  });
  mocks.navigate.mockClear();
  mocks.matches = [];
  mocks.file.mockReset().mockResolvedValue(null);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId("scratch-key", projectRef, DraftId.make("existing"), {
      threadId: ThreadId.make("existing-thread"),
      worktreePath: "/scratch/prepared-folder",
    });
});

describe("Scratch draft reuse", () => {
  it("keeps a reusable draft's prepared folder when opening it again", async () => {
    await useNewThreadHandler()(projectRef);
    expect(
      useComposerDraftStore.getState().getDraftSessionByLogicalProjectKey("scratch-key"),
    ).toMatchObject({ threadId: "existing-thread", worktreePath: "/scratch/prepared-folder" });
  });
  it("never gives a new draft the folder of an already-promoted draft", async () => {
    mocks.readThreadShell.mockReturnValue({ id: "existing-thread" });
    await useNewThreadHandler()(projectRef);
    const draft = useComposerDraftStore
      .getState()
      .getDraftSessionByLogicalProjectKey("scratch-key");
    expect(draft?.threadId).not.toBe("existing-thread");
    expect(draft?.worktreePath).toBeNull();
  });
});

it("creates a fresh project draft using the last launch model and the target workspace defaults", async () => {
  const store = useComposerDraftStore.getState();
  store.clearDraftThread(DraftId.make("existing"));
  mocks.readProject.mockReturnValue({
    id: "target",
    environmentId: "remote",
    workspaceRoot: "/target",
  });
  const selection = { instanceId: ProviderInstanceId.make("claude-code"), model: "target-model" };
  mocks.configs.set("remote", {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadEnvMode: "worktree",
      newWorktreesStartFromOrigin: true,
      defaultRuntimeMode: "full-access",
      defaultModelSelection: selection,
    },
  });
  store.setStickyModelSelection({
    instanceId: ProviderInstanceId.make("codex"),
    model: "sticky-model",
  });
  await useNewThreadHandler()(
    scopeProjectRef(EnvironmentId.make("remote"), ProjectId.make("target")),
  );
  const draft = store.getDraftSessionByLogicalProjectKey("scratch-key")!;
  expect(draft).toMatchObject({
    environmentId: "remote",
    projectId: "target",
    runtimeMode: "full-access",
    envMode: "worktree",
    startFromOrigin: true,
    branch: null,
    worktreePath: null,
  });
  expect(store.getComposerDraft(draft.draftId)).toMatchObject({
    activeProvider: "codex",
    modelSelectionByProvider: { codex: { model: "sticky-model" } },
  });
});

it("explicit workspace launch options override resolved project defaults", async () => {
  const store = useComposerDraftStore.getState();
  store.clearDraftThread(DraftId.make("existing"));
  mocks.readProject.mockReturnValue({
    id: "target",
    environmentId: "local",
    workspaceRoot: "/target",
  });
  mocks.configs.set("local", {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadEnvMode: "worktree",
      newWorktreesStartFromOrigin: true,
    },
  });
  await useNewThreadHandler()(
    scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("target")),
    { envMode: "local", branch: "chosen", worktreePath: "/chosen", startFromOrigin: false },
  );
  expect(store.getDraftSessionByLogicalProjectKey("scratch-key")).toMatchObject({
    envMode: "local",
    branch: "chosen",
    worktreePath: "/chosen",
    startFromOrigin: false,
  });
});

it("keeps the latest destination when an earlier t3.json read finishes later", async () => {
  const store = useComposerDraftStore.getState();
  store.clearDraftThread(DraftId.make("existing"));
  mocks.readProject.mockImplementation((ref) => ({
    id: ref.projectId,
    environmentId: ref.environmentId,
    workspaceRoot: `/${ref.projectId}`,
  }));
  mocks.configs.set("local", {
    settings: { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: null },
  });
  let finishFirst!: (value: null) => void;
  mocks.file.mockImplementation((_env, cwd) =>
    cwd === "/a"
      ? new Promise<null>((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve(null),
  );
  const open = useNewThreadHandler();
  const first = open(scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("a")));
  await open(scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("b")));
  finishFirst(null);
  await first;
  expect(store.getDraftSessionByLogicalProjectKey("scratch-key")?.projectId).toBe("b");
  expect(mocks.navigate).toHaveBeenCalledOnce();
});

it("refreshes defaults when the open logical draft moves to a different physical project", async () => {
  const store = useComposerDraftStore.getState();
  mocks.matches = [{ params: { draftId: "existing" } }];
  mocks.readProject.mockReturnValue({
    id: "target",
    environmentId: "remote",
    workspaceRoot: "/target",
  });
  const model = { instanceId: ProviderInstanceId.make("claude-code"), model: "target-model" };
  mocks.configs.set("remote", {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultThreadEnvMode: "worktree",
      defaultModelSelection: model,
    },
  });
  store.setPrompt(DraftId.make("existing"), "Keep this prompt");
  store.setModelSelection(DraftId.make("existing"), {
    instanceId: ProviderInstanceId.make("codex"),
    model: "old-default",
  });
  await useNewThreadHandler()(
    scopeProjectRef(EnvironmentId.make("remote"), ProjectId.make("target")),
  );
  expect(store.getDraftSession(DraftId.make("existing"))).toMatchObject({
    environmentId: "remote",
    projectId: "target",
    envMode: "worktree",
    worktreePath: null,
  });
  expect(store.getComposerDraft(DraftId.make("existing"))).toMatchObject({
    prompt: "Keep this prompt",
    activeProvider: "claude-code",
    modelSelectionByProvider: { "claude-code": model },
  });
});

it("ignores the viewed thread's model when opening a new thread", async () => {
  const store = useComposerDraftStore.getState();
  store.clearDraftThread(DraftId.make("existing"));
  mocks.matches = [{ params: { environmentId: "local", threadId: "viewed" } }];
  mocks.readThreadShell.mockReturnValue({
    id: "viewed",
    modelSelection: { instanceId: "claudeAgent", model: "claude-fable-5" },
  });
  store.setStickyModelSelection({
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6-sol",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "fast" },
    ],
  });
  await useNewThreadHandler()(projectRef);
  const draft = store.getDraftSessionByLogicalProjectKey("scratch-key")!;
  expect(store.getComposerDraft(draft.draftId)).toMatchObject({
    activeProvider: "codex",
    modelSelectionByProvider: {
      codex: {
        model: "gpt-6-sol",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    },
  });
});

it.each([false, true])(
  "refreshes a reused draft unless its model was explicitly chosen (%s)",
  async (explicit) => {
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("existing");
    const chosen = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
      options: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ],
    };
    store.setModelSelection(draftId, chosen, { explicit });
    store.setStickyModelSelection({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    store.setPrompt(draftId, "Keep this text");
    await useNewThreadHandler()(projectRef);
    const draft = store.getComposerDraft(draftId)!;
    expect(draft.prompt).toBe("Keep this text");
    expect(draft.activeProvider).toBe(explicit ? "claudeAgent" : "codex");
    if (explicit)
      expect(draft.modelSelectionByProvider[ProviderInstanceId.make("claudeAgent")]).toEqual(
        chosen,
      );
    else
      expect(draft.modelSelectionByProvider[ProviderInstanceId.make("codex")]?.options).toEqual([
        { id: "reasoningEffort", value: "high" },
      ]);
  },
);
