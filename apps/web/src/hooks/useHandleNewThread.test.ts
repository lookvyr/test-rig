import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn().mockResolvedValue(undefined),
  readThreadShell: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ defaultThreadEnvMode: "local", newWorktreesStartFromOrigin: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: [] }, navigate: mocks.navigate }),
  useParams: vi.fn(),
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => new Map([["local", { scratchWorkspaceRoot: "/scratch" }]]) },
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: {},
}));
vi.mock("../state/entities", () => ({
  readProject: () => ({ id: "scratch", environmentId: "local", workspaceRoot: "/scratch" }),
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
  mocks.navigate.mockClear();
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
