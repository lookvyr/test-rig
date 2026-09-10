import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async (_tabId: string, _url: string): Promise<void> => undefined),
  rememberPreviewUrl: vi.fn(),
  readPreparedConnection: vi.fn(() => ({ httpBaseUrl: "http://172.25.85.75:3773" })),
  submittedUrl: null as ((url: string) => boolean) | null,
  toast: vi.fn(),
  activeTabId: "tab-1" as string | null,
  openSession: vi.fn(),
  emptyStateUrl: null as ((url: string) => void) | null,
  togglePictureInPicture: null as (() => void) | null,
  toggleNativePictureInPicture: null as (() => void) | null,
  pictureInPicturePressed: false,
  miniPlayerTabId: null as string | null,
  openMiniPlayer: vi.fn(),
  closeMiniPlayer: vi.fn(),
  closeRightPanel: vi.fn(),
  openPictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  closePictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  pickElement: vi.fn(),
  previewAnnotationScreenshotFile: vi.fn(),
  addPreviewAnnotation: vi.fn(),
  addImage: vi.fn(),
  toggleAnnotation: null as (() => void) | null,
  pictureInPicture: false,
  showEmptyState: false,
}));

vi.mock("~/state/session", () => ({
  readPreparedConnection: mocks.readPreparedConnection,
}));

vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: (
    select: (store: { addPreviewAnnotation: () => void; addImage: () => void }) => unknown,
  ) =>
    select({
      addPreviewAnnotation: mocks.addPreviewAnnotation,
      addImage: mocks.addImage,
    }),
}));

vi.mock("~/lib/previewAnnotation", () => ({
  previewAnnotationScreenshotFile: mocks.previewAnnotationScreenshotFile,
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: vi.fn(),
}));

vi.mock("~/previewStateStore", () => ({
  rememberPreviewUrl: mocks.rememberPreviewUrl,
  updatePreviewServerSnapshot: vi.fn(),
  useThreadPreviewState: () => ({
    activeTabId: mocks.activeTabId,
    desktopByTabId: {
      "tab-1": {
        hasWebContents: true,
        canGoBack: false,
        canGoForward: false,
        loading: false,
        zoomFactor: 1,
        pictureInPicture: mocks.pictureInPicture,
        colorScheme: "system",
        controller: "none",
      },
    },
    recentlySeenUrls: [],
    sessions: mocks.showEmptyState
      ? {}
      : {
          "tab-1": {
            threadId: "thread-1",
            tabId: "tab-1",
            navStatus: {
              _tag: "Success",
              url: "http://example.com/",
              title: "Example",
            },
            canGoBack: false,
            canGoForward: false,
            updatedAt: "2026-07-13T00:00:00.000Z",
          },
        },
  }),
}));

vi.mock("~/state/environments", () => ({
  useEnvironment: () => ({ label: "WSL" }),
  useEnvironmentHttpBaseUrl: () => "http://172.25.85.75:3773",
}));

vi.mock("~/state/preview", () => ({
  previewEnvironment: { open: {}, resize: {} },
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));

vi.mock("~/browser/browserRecording", () => ({
  findActiveBrowserRecordingRuntimeTabId: vi.fn(() => null),
  startBrowserRecording: vi.fn(),
  stopBrowserRecording: vi.fn(),
  useActiveBrowserRecordingTabIds: () => new Set(),
}));

vi.mock("~/browser/browserSurfaceStore", () => ({
  useBrowserSurfaceStore: (
    select: (state: { byTabId: Record<string, { rect?: unknown }> }) => unknown,
  ) => select({ byTabId: {} }),
}));

vi.mock("~/previewMiniPlayerStore", () => {
  const usePreviewMiniPlayerStore = Object.assign(
    (select: (state: unknown) => unknown) =>
      select({
        byThreadKey: mocks.miniPlayerTabId
          ? {
              "environment-1:thread-1": {
                tabId: mocks.miniPlayerTabId,
                position: null,
              },
            }
          : {},
      }),
    {
      getState: () => ({
        open: mocks.openMiniPlayer,
        close: mocks.closeMiniPlayer,
      }),
    },
  );
  return {
    selectThreadPreviewMiniPlayer: (
      byThreadKey: Record<string, { tabId: string; position: null }>,
    ) => byThreadKey["environment-1:thread-1"] ?? null,
    usePreviewMiniPlayerStore,
  };
});

vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ close: mocks.closeRightPanel }),
  },
}));

vi.mock("~/components/ui/toast", () => ({
  stackedThreadToast: vi.fn(),
  toastManager: { add: mocks.toast },
}));

vi.mock("./previewBridge", () => ({
  previewBridge: {
    navigate: mocks.navigate,
    pickElement: mocks.pickElement,
    pictureInPicture: {
      open: mocks.openPictureInPicture,
      close: mocks.closePictureInPicture,
    },
  },
}));

vi.mock("./PreviewChromeRow", () => ({
  PreviewChromeRow: (props: {
    onSubmit: (url: string) => boolean;
    onPickElement?: () => void;
    onPictureInPicture?: () => void;
    pictureInPicture?: boolean;
    trailingActions?: {
      props: { onNativePictureInPicture?: () => void };
    };
  }) => {
    mocks.submittedUrl = props.onSubmit;
    mocks.toggleAnnotation = props.onPickElement ?? null;
    mocks.togglePictureInPicture = props.onPictureInPicture ?? null;
    mocks.toggleNativePictureInPicture =
      props.trailingActions?.props.onNativePictureInPicture ?? null;
    mocks.pictureInPicturePressed = props.pictureInPicture ?? false;
    return null;
  },
}));

vi.mock("./PreviewEmptyState", () => ({
  PreviewEmptyState: (props: { onOpenUrl: (url: string) => void }) => {
    mocks.emptyStateUrl = props.onOpenUrl;
    return null;
  },
}));
vi.mock("./PreviewMoreMenu", () => ({
  PreviewMoreMenu: (props: { onNativePictureInPicture: () => void }) => {
    mocks.toggleNativePictureInPicture = props.onNativePictureInPicture;
    return null;
  },
}));
vi.mock("./PreviewUnreachable", () => ({ PreviewUnreachable: () => null }));
vi.mock("./ZoomIndicator", () => ({ ZoomIndicator: () => null }));
vi.mock("./AgentBrowserCursor", () => ({ AgentBrowserCursor: () => null }));
vi.mock("~/browser/BrowserSurfaceSlot", () => ({ BrowserSurfaceSlot: () => null }));
vi.mock("./useLoadingProgress", () => ({ useLoadingProgress: () => 0 }));
vi.mock("./usePreviewSession", () => ({ usePreviewSession: vi.fn() }));
vi.mock("./openPreviewSession", () => ({ openPreviewSession: mocks.openSession }));

import { PreviewView } from "./PreviewView";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";

const TEST_THREAD_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
} as const;
const TEST_RUNTIME_TAB_ID = previewRuntimeTabId(TEST_THREAD_REF, null, "tab-1");

describe("PreviewView navigation", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.rememberPreviewUrl.mockClear();
    mocks.readPreparedConnection.mockClear();
    mocks.submittedUrl = null;
    mocks.toast.mockClear();
    mocks.activeTabId = "tab-1";
    mocks.openSession.mockReset();
    mocks.emptyStateUrl = null;
    mocks.togglePictureInPicture = null;
    mocks.toggleNativePictureInPicture = null;
    mocks.pictureInPicturePressed = false;
    mocks.miniPlayerTabId = null;
    mocks.openMiniPlayer.mockClear();
    mocks.closeMiniPlayer.mockClear();
    mocks.closeRightPanel.mockClear();
    mocks.openPictureInPicture.mockClear();
    mocks.closePictureInPicture.mockClear();
    mocks.pickElement.mockReset();
    mocks.previewAnnotationScreenshotFile.mockReset();
    mocks.addPreviewAnnotation.mockClear();
    mocks.addImage.mockClear();
    mocks.toggleAnnotation = null;
    mocks.pictureInPicture = false;
    mocks.showEmptyState = false;
  });

  it("submits search terms to the active browser tab", async () => {
    renderToStaticMarkup(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />);

    expect(mocks.submittedUrl?.("responsive design examples")).toBe(true);
    expect(mocks.navigate).toHaveBeenCalledWith(
      TEST_RUNTIME_TAB_ID,
      "https://www.google.com/search?q=responsive+design+examples",
    );
  });

  it("keeps invalid input editable and reports an error without navigating", () => {
    renderToStaticMarkup(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />);

    expect(mocks.submittedUrl?.("https://example.com:bad/private?token=secret")).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Unable to open address",
      description: "Check the URL. Only http:// and https:// addresses are supported.",
    });
  });

  it("leaves desktop load failures to navigation state, avoiding false errors on abort", async () => {
    const failure = new Error("ERR_ABORTED");
    mocks.navigate.mockRejectedValueOnce(failure);
    renderToStaticMarkup(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />);

    expect(mocks.submittedUrl?.("example.com")).toBe(true);
    await mocks.navigate.mock.results[0]?.value.catch(() => undefined);
    await Promise.resolve();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("reports a failure to open the initial browser session", async () => {
    mocks.activeTabId = null;
    mocks.openSession.mockRejectedValueOnce(new Error("Browser unavailable"));
    renderToStaticMarkup(<PreviewView threadRef={TEST_THREAD_REF} visible />);

    expect(mocks.submittedUrl?.("example.com")).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        type: "error",
        title: "Unable to load page",
        description: "Check the address and your connection, then try again.",
      }),
    );
  });

  it.each([
    [
      "https://localhost:8000/dashboard?mode=test#top",
      "https://localhost:8000/dashboard?mode=test#top",
    ],
    ["localhost:5173/app", "http://localhost:5173/app"],
  ])("preserves a direct localhost URL in a WSL environment", async (submitted, expected) => {
    renderToStaticMarkup(
      <PreviewView
        threadRef={{
          environmentId: EnvironmentId.make("environment-1"),
          threadId: ThreadId.make("thread-1"),
        }}
        tabId="tab-1"
        visible
      />,
    );

    expect(mocks.submittedUrl).not.toBeNull();
    mocks.submittedUrl?.(submitted);

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID, expected),
    );
    expect(mocks.rememberPreviewUrl).toHaveBeenCalledWith(
      {
        environmentId: "environment-1",
        threadId: "thread-1",
      },
      expected,
    );
  });

  it("maps an empty-state localhost server onto the WSL host", async () => {
    mocks.showEmptyState = true;
    renderToStaticMarkup(
      <PreviewView
        threadRef={{
          environmentId: EnvironmentId.make("environment-1"),
          threadId: ThreadId.make("thread-1"),
        }}
        tabId="tab-1"
        visible
      />,
    );

    expect(mocks.emptyStateUrl).not.toBeNull();
    mocks.emptyStateUrl?.("http://localhost:5173/app?mode=test#top");

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        TEST_RUNTIME_TAB_ID,
        "http://172.25.85.75:5173/app?mode=test#top",
      ),
    );
    expect(mocks.rememberPreviewUrl).toHaveBeenCalledWith(
      {
        environmentId: "environment-1",
        threadId: "thread-1",
      },
      "http://172.25.85.75:5173/app?mode=test#top",
    );
  });

  it("opens and closes a thread-scoped floating preview for the active tab", async () => {
    const props = {
      threadRef: {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
      },
      tabId: "tab-1",
      visible: true,
    } as const;

    renderToStaticMarkup(<PreviewView {...props} />);
    expect(mocks.pictureInPicturePressed).toBe(false);
    mocks.togglePictureInPicture?.();
    expect(mocks.openMiniPlayer).toHaveBeenCalledWith(props.threadRef, "tab-1");
    expect(mocks.closeRightPanel).toHaveBeenCalledWith(props.threadRef);

    mocks.miniPlayerTabId = "tab-1";
    renderToStaticMarkup(<PreviewView {...props} />);
    expect(mocks.pictureInPicturePressed).toBe(true);
    mocks.togglePictureInPicture?.();
    expect(mocks.closeMiniPlayer).toHaveBeenCalledWith(props.threadRef);
  });

  it("keeps the native preview window as a secondary action", async () => {
    const props = {
      threadRef: {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
      },
      tabId: "tab-1",
      visible: true,
    } as const;

    renderToStaticMarkup(<PreviewView {...props} />);
    mocks.toggleNativePictureInPicture?.();
    await vi.waitFor(() =>
      expect(mocks.openPictureInPicture).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID),
    );

    mocks.pictureInPicture = true;
    renderToStaticMarkup(<PreviewView {...props} />);
    mocks.toggleNativePictureInPicture?.();
    await vi.waitFor(() =>
      expect(mocks.closePictureInPicture).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID),
    );
  });

  it("forwards Cmd/Ctrl+Enter annotations to the composer send path", async () => {
    const annotation = {
      id: "annotation-1",
      pageUrl: "https://example.com/dashboard",
      pageTitle: "Dashboard",
      comment: "Tighten this spacing",
      elements: [],
      regions: [],
      strokes: [],
      styleChanges: [],
      screenshot: null,
      createdAt: "2026-07-27T00:00:00.000Z",
    };
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({ annotation, submission: "send" });

    renderToStaticMarkup(
      <PreviewView
        threadRef={TEST_THREAD_REF}
        tabId="tab-1"
        visible
        onSendAnnotation={onSendAnnotation}
      />,
    );
    mocks.toggleAnnotation?.();

    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(annotation, null));
    expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, annotation);
  });

  it("still sends when screenshot attachment conversion fails", async () => {
    const annotation = {
      id: "annotation-2",
      pageUrl: "https://example.com/dashboard",
      pageTitle: "Dashboard",
      comment: "Tighten this spacing",
      elements: [],
      regions: [],
      strokes: [],
      styleChanges: [],
      screenshot: {
        dataUrl: "data:image/png;base64,c2NyZWVuc2hvdA==",
        width: 10,
        height: 10,
        cropRect: { x: 0, y: 0, width: 10, height: 10 },
      },
      createdAt: "2026-07-27T00:00:00.000Z",
    };
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({ annotation, submission: "send" });
    mocks.previewAnnotationScreenshotFile.mockRejectedValue(new Error("conversion failed"));

    renderToStaticMarkup(
      <PreviewView
        threadRef={TEST_THREAD_REF}
        tabId="tab-1"
        visible
        onSendAnnotation={onSendAnnotation}
      />,
    );
    mocks.toggleAnnotation?.();

    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(annotation, null));
    expect(mocks.addImage).not.toHaveBeenCalled();
  });
});
