import type { PreviewOpenInput, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readThreadPreviewState, resetPreviewStateForTests } from "~/previewStateStore";

import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import { openPreviewSession } from "./openPreviewSession";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: {
    _tag: "Loading",
    url: "https://t3.chat/",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-11T23:00:00.000Z",
};

beforeEach(() => {
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});

describe("openPreviewSession", () => {
  it("creates an idle tab without recording a recently visited URL", async () => {
    const idleSnapshot: PreviewSessionSnapshot = {
      ...snapshot,
      tabId: "tab-blank",
      navStatus: { _tag: "Idle" },
    };
    const open = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(idleSnapshot));

    await openPreviewSession({
      openPreview: ({ input }) => open(input),
      threadRef,
    });

    expect(open).toHaveBeenCalledWith({ threadId: "thread-1", profileId: "default" });
    expect(readThreadPreviewState(threadRef).snapshot).toEqual(idleSnapshot);
    expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);
  });

  it("applies the RPC response without waiting for a preview event", async () => {
    const open = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(snapshot));

    await openPreviewSession({
      openPreview: ({ input }) => open(input),
      threadRef,
      url: "t3.chat",
    });

    expect(open).toHaveBeenCalledWith({
      threadId: "thread-1",
      url: "t3.chat",
      profileId: "default",
    });
    expect(readThreadPreviewState(threadRef).snapshot).toEqual(snapshot);
    expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual(["https://t3.chat/"]);
  });

  it("returns failures without mutating preview state", async () => {
    const failure = new Error("preview unavailable");

    const result = await openPreviewSession({
      openPreview: async () => AsyncResult.failure(Cause.fail(failure)),
      threadRef,
      url: "t3.chat",
    });

    expect(result._tag).toBe("Failure");
    expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
    expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);
  });
});

it("uses the saved profile default and retains an explicitly chosen profile", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
    browserDefaultProfileId: "work",
  });
  const open = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(snapshot));
  await openPreviewSession({ threadRef, openPreview: ({ input }) => open(input) });
  expect(open).toHaveBeenLastCalledWith({ threadId: "thread-1", profileId: "work" });
  await openPreviewSession({
    threadRef,
    profileId: "incognito",
    openPreview: ({ input }) => open(input),
  });
  expect(open).toHaveBeenLastCalledWith({ threadId: "thread-1", profileId: "incognito" });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, browserDefaultProfileId: "deleted" });
  await openPreviewSession({ threadRef, openPreview: ({ input }) => open(input) });
  expect(open).toHaveBeenLastCalledWith({ threadId: "thread-1", profileId: "default" });
});
