import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { usePreviewBridge } from "./usePreviewBridge";

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  open: vi.fn(),
  subscribe: vi.fn<(listener: (tabId: string, url: string) => unknown) => () => void>(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock("./previewBridge", () => ({
  previewBridge: { onWindowOpen: mocks.subscribe },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (_command: unknown, label: string) =>
    label === "open browser tab" ? mocks.open : vi.fn(),
}));
vi.mock("~/browser/browserPointerStore", () => ({
  useBrowserPointerStore: (select: (state: { clear: () => void }) => unknown) =>
    select({ clear: vi.fn() }),
}));

const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
};
const source: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "opener",
  runtime: "desktop",
  profileId: "work",
  viewport: { _tag: "freeform", width: 900, height: 700 },
  navStatus: { _tag: "Success", url: "https://example.com", title: "Opener" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-14T00:00:00.000Z",
};
const child: PreviewSessionSnapshot = {
  ...source,
  tabId: "new-tab",
  navStatus: { _tag: "Loading", url: "https://example.com/new", title: "" },
};
const runtimeTabId = previewRuntimeTabId(threadRef, null, source.tabId);

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.subscribe.mockReset().mockReturnValue(vi.fn());
  mocks.open.mockReset().mockResolvedValue(AsyncResult.success(child));
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
  applyPreviewServerSnapshot(threadRef, source);
  useRightPanelStore.getState().openBrowser(threadRef, source.tabId);
  usePreviewBridge({ threadRef, tabId: source.tabId, runtimeTabId });
  for (const effect of mocks.effects) effect();
});

describe("desktop popup tabs", () => {
  it("opens a new tab in the opener's thread and profile while keeping its original page", async () => {
    await mocks.subscribe.mock.calls[0]![0](runtimeTabId, "https://example.com/new");
    expect(mocks.open).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        url: "https://example.com/new",
        profileId: "work",
        viewport: source.viewport,
      },
    });
    expect(readThreadPreviewState(threadRef).sessions[source.tabId]).toEqual(source);
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      ).surfaces.map((surface) => surface.id),
    ).toEqual(["browser:opener", "browser:new-tab"]);
  });

  it("ignores requests belonging to another environment's runtime tab", async () => {
    const otherRuntime = previewRuntimeTabId(
      { ...threadRef, environmentId: EnvironmentId.make("other") },
      null,
      source.tabId,
    );
    await mocks.subscribe.mock.calls[0]![0](otherRuntime, "https://example.com/new");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("keeps the original tab available when opening the new one fails", async () => {
    mocks.open.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("offline"))));
    await mocks.subscribe.mock.calls[0]![0](runtimeTabId, "https://example.com/new");
    expect(readThreadPreviewState(threadRef).sessions[source.tabId]).toEqual(source);
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      ).surfaces.map((surface) => surface.id),
    ).toEqual(["browser:opener"]);
  });
});
