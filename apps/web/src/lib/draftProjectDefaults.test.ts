import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { threadContextRecord } from "./composerContextRecords";
import { resolveDraftProjectDefaults, retargetDraftProject } from "./draftProjectDefaults";

const mocks = vi.hoisted(() => ({ configs: new Map(), project: vi.fn(), file: vi.fn() }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => mocks.configs } }));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/entities", () => ({ readProject: mocks.project }));
vi.mock("./t3ProjectFileDefaults", () => ({ readT3ProjectFile: mocks.file }));
const ref = scopeProjectRef(EnvironmentId.make("destination"), ProjectId.make("b"));
const model = { instanceId: ProviderInstanceId.make("claude-code"), model: "project-model" };
const draftId = DraftId.make("draft-defaults");
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  defaultModelSelection: model,
  defaultRuntimeMode: "approval-required" as const,
  defaultThreadEnvMode: "worktree" as const,
  newWorktreesStartFromOrigin: true,
};

beforeEach(() => {
  mocks.configs.clear();
  mocks.file.mockReset().mockResolvedValue(null);
  mocks.project.mockReset().mockReturnValue({
    id: ref.projectId,
    workspaceRoot: "/b",
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
  });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
});

describe("destination draft defaults", () => {
  it("uses target environment and project overrides rather than another environment's settings", async () => {
    mocks.configs.set("primary", { settings: { ...settings, defaultRuntimeMode: "full-access" } });
    mocks.configs.set("destination", {
      settings: {
        ...settings,
        projectSettingsOverrides: {
          b: {
            defaultRuntimeMode: "full-access",
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "b-model",
            },
            defaultThreadEnvMode: "local",
          },
        },
      },
    });
    expect(await resolveDraftProjectDefaults(ref)).toMatchObject({
      defaultRuntimeMode: "full-access",
      defaultModelSelection: { model: "b-model" },
      defaultThreadEnvMode: "local",
    });
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it("consults t3.json only when the workspace setting is unset", async () => {
    mocks.configs.set("destination", { settings: { ...settings, defaultThreadEnvMode: null } });
    mocks.file.mockResolvedValue({ defaultThreadEnvMode: "worktree" });
    expect((await resolveDraftProjectDefaults(ref)).defaultThreadEnvMode).toBe("worktree");
    expect(mocks.file).toHaveBeenCalledWith("destination", "/b");
  });
  it("applies target defaults over sticky state and keeps composer content", () => {
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId(
      "a",
      scopeProjectRef(EnvironmentId.make("origin"), ProjectId.make("a")),
      draftId,
      { threadId: ThreadId.make("draft-thread"), branch: "old", worktreePath: "/old" },
    );
    store.setPrompt(draftId, "Keep this rich prompt");
    const context = threadContextRecord(
      { environmentId: EnvironmentId.make("destination"), threadId: ThreadId.make("context") },
      "Reference",
    );
    store.setThreadContexts(draftId, [context]);
    store.setStickyModelSelection({
      instanceId: ProviderInstanceId.make("codex"),
      model: "sticky",
    });
    retargetDraftProject({
      draftId,
      projectRef: ref,
      logicalProjectKey: "b",
      defaults: resolveProjectSettings(settings, ref.projectId, null, null).settings,
      scratch: false,
    });
    expect(store.getDraftSession(draftId)).toMatchObject({
      environmentId: "destination",
      projectId: "b",
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
      runtimeMode: "approval-required",
    });
    expect(store.getComposerDraft(draftId)).toMatchObject({
      prompt: "Keep this rich prompt",
      threadContexts: [context],
      activeProvider: "claude-code",
      modelSelectionByProvider: { "claude-code": model },
    });
  });
  it("preserves deliberately selected model and permission overrides through retargeting", () => {
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId("a", ref, draftId, {
      threadId: ThreadId.make("draft-thread"),
    });
    const chosen = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "chosen",
      options: [{ id: "reasoning", value: "high" }],
    };
    store.setModelSelection(draftId, chosen, { explicit: true });
    store.setRuntimeMode(draftId, "full-access");
    retargetDraftProject({
      draftId,
      projectRef: ref,
      logicalProjectKey: "b",
      defaults: resolveProjectSettings(settings, ref.projectId, null, null).settings,
      scratch: false,
    });
    expect(store.getComposerDraft(draftId)).toMatchObject({
      activeProvider: "codex",
      modelSelectionExplicit: true,
      modelSelectionByProvider: { codex: chosen },
      runtimeMode: "full-access",
    });
  });
  it("keeps scratch drafts local even when project workspace defaults request a worktree", () => {
    const store = useComposerDraftStore.getState();
    store.setLogicalProjectDraftThreadId("a", ref, draftId, {
      threadId: ThreadId.make("draft-thread"),
    });
    retargetDraftProject({
      draftId,
      projectRef: ref,
      logicalProjectKey: "scratch",
      defaults: resolveProjectSettings(settings, ref.projectId, null, null).settings,
      scratch: true,
    });
    expect(store.getDraftSession(draftId)).toMatchObject({
      envMode: "local",
      startFromOrigin: false,
      worktreePath: null,
    });
  });
});
