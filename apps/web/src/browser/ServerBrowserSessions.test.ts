import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ native: true, autoShow: true }));

vi.mock("./previewRuntime", () => ({ rendersServerTabNatively: () => mocks.native }));
vi.mock("~/hooks/useSettings", () => ({
  getClientSettings: () => ({ browserAutoShowFloatingPreview: mocks.autoShow }),
}));

import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { revealServerTab } from "./ServerBrowserSessions";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const reveal = (tabId: string, force = false) =>
  revealServerTab(threadRef, {
    tabId,
    runtime: "server",
    revealRequest: { id: `reveal-${tabId}`, force },
  } as unknown as PreviewSessionSnapshot);
const panel = () => useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
const floating = () =>
  usePreviewMiniPlayerStore.getState().byThreadKey[scopedThreadKey(threadRef)]?.tabId ?? null;

describe("revealServerTab", () => {
  beforeEach(() => {
    mocks.native = true;
    mocks.autoShow = true;
    useRightPanelStore.setState({ byThreadKey: {} });
    usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  });

  it("floats a desktop-rendered tab that already has a panel tab while the panel is closed", () => {
    useRightPanelStore.getState().openBrowser(threadRef, "tab-a");
    useRightPanelStore.getState().close(threadRef);

    reveal("tab-a");

    expect(floating()).toBe("tab-a");
    expect(panel()?.isOpen).toBe(false);
  });

  it("leaves a tab alone when the open panel already shows it", () => {
    useRightPanelStore.getState().openBrowser(threadRef, "tab-a");

    reveal("tab-a");

    expect(floating()).toBeNull();
    expect(panel()?.activeSurfaceId).toBe("browser:tab-a");
  });

  it("opens the panel for streamed tabs and forced reveals", () => {
    mocks.native = false;
    reveal("tab-a");
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab-a" });

    mocks.native = true;
    reveal("tab-b", true);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab-b" });
    expect(floating()).toBeNull();
  });
});
