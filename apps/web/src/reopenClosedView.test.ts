import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_BROWSER_PROFILE_ID,
  EnvironmentId,
  ThreadId,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useClosedViewStore } from "./closedViewStore";
import { planNextReopen, reopenClosedView } from "./reopenClosedView";
import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
const snapshot: PreviewSessionSnapshot = {
  threadId: ref.threadId,
  tabId: "old",
  navStatus: { _tag: "Success", title: "App", url: "https://example.com" },
  canGoBack: false,
  canGoForward: false,
  viewport: { _tag: "freeform", width: 480, height: 640 },
  updatedAt: "2026-10-06T12:00:00.000Z",
};
beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("reopen closed views", () => {
  it("records user closes in reverse order, prioritizing the active view, without recording reconciliation or killed terminals", () => {
    const store = useRightPanelStore.getState();
    store.openFile(ref, "a.ts");
    store.open(ref, "diff");
    store.openFile(ref, "b.ts", 9);
    store.openTerminal(ref, "terminal");
    store.activateSurface(ref, "diff");
    store.closeAllSurfaces(ref);
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : "browser")),
    ).toEqual(["diff", "file:b.ts", "file:a.ts"]);
    useClosedViewStore.setState({ entries: [] });
    store.openFile(ref, "missing.ts");
    store.reconcileFileSurfaces(ref, false);
    expect(useClosedViewStore.getState().entries).toEqual([]);
  });
  it("restores file reveal state and skips an unavailable workspace", async () => {
    const view = {
      kind: "panel-tab" as const,
      threadRef: ref,
      surface: {
        kind: "file" as const,
        id: "file:a.ts" as const,
        relativePath: "a.ts",
        revealLine: 9,
        revealRequestId: 2,
      },
    };
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    expect(await reopenClosedView(view, { openPreview, workspaceAvailable: false })).toBe(false);
    expect(await reopenClosedView(view, { openPreview, workspaceAvailable: true })).toBe(true);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces[0],
    ).toMatchObject({ relativePath: "a.ts", revealLine: 9 });
    expect(openPreview).not.toHaveBeenCalled();
  });
  it.each([undefined, "work"])(
    "restores browser URL, viewport and original profile %s",
    async (profileId) => {
      const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new" }));
      expect(
        await reopenClosedView(
          {
            kind: "browser",
            threadRef: ref,
            snapshot: { ...snapshot, ...(profileId === undefined ? {} : { profileId }) },
          },
          { openPreview, workspaceAvailable: true },
        ),
      ).toBe(true);
      expect(openPreview).toHaveBeenCalledWith({
        environmentId: ref.environmentId,
        input: {
          threadId: ref.threadId,
          url: snapshot.navStatus._tag === "Idle" ? undefined : snapshot.navStatus.url,
          viewport: snapshot.viewport,
          profileId: profileId ?? DEFAULT_BROWSER_PROFILE_ID,
        },
      });
    },
  );
  it("retains a failed browser restore for retry", async () => {
    const id = useClosedViewStore
      .getState()
      .remember({ kind: "browser", threadRef: ref, snapshot });
    expect(
      await reopenClosedView(useClosedViewStore.getState().entries[0]!, {
        openPreview: async () => AsyncResult.failure(Cause.fail("offline")),
        workspaceAvailable: true,
      }),
    ).toBe(false);
    expect(useClosedViewStore.getState().entries[0]?.id).toBe(id);
  });
  it("drops already open views but retains unavailable owners", () => {
    const store = useClosedViewStore.getState();
    store.remember({ kind: "panel-tab", threadRef: ref, surface: { id: "files", kind: "files" } });
    store.remember({ kind: "panel-tab", threadRef: ref, surface: { id: "diff", kind: "diff" } });
    const owner = {
      environmentKnown: true,
      catalogReady: true,
      ownerExists: true,
      shellLive: true,
      panel: {
        isOpen: true,
        activeSurfaceId: "diff",
        surfaces: [{ id: "diff" as const, kind: "diff" as const }],
      },
    };
    expect(planNextReopen(useClosedViewStore.getState().entries, () => owner)).toMatchObject({
      drop: [{ surface: { id: "diff" } }],
      restore: { surface: { id: "files" } },
    });
    expect(
      planNextReopen(useClosedViewStore.getState().entries, () => ({
        ...owner,
        ownerExists: false,
      })),
    ).toEqual({ drop: [], restore: null });
  });
  it("bounds and deduplicates global history", () => {
    const store = useClosedViewStore.getState();
    for (let i = 0; i < 30; i++)
      store.remember({
        kind: "panel-tab",
        threadRef: ref,
        surface: {
          id: `file:${i}`,
          kind: "file",
          relativePath: String(i),
          revealLine: null,
          revealRequestId: 0,
        },
      });
    expect(useClosedViewStore.getState().entries).toHaveLength(20);
    store.remember({
      kind: "panel-tab",
      threadRef: ref,
      surface: {
        id: "file:29",
        kind: "file",
        relativePath: "29",
        revealLine: null,
        revealRequestId: 0,
      },
    });
    expect(useClosedViewStore.getState().entries).toHaveLength(20);
  });
});
