import { it as effectIt } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as PreviewManager from "../../preview/Manager.ts";
import * as PreviewIpc from "./preview.ts";

const { fromPartition } = vi.hoisted(() => ({
  fromPartition: vi.fn(() => {
    throw new Error("Session can only be received when app is ready");
  }),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  session: {
    fromPartition,
  },
  webContents: {
    fromId: vi.fn(() => null),
  },
}));

describe("preview IPC methods", () => {
  beforeEach(() => {
    fromPartition.mockClear();
  });

  it("does not access the Electron session while the module loads", async () => {
    await expect(import("./preview.ts")).resolves.toBeDefined();
    expect(fromPartition).not.toHaveBeenCalled();
  });

  effectIt.effect("returns browser status for a delegated thread's scoped runtime tab id", () => {
    const tabId = JSON.stringify([
      "1207522d-5dfe-448d-898e-9bc0212be669",
      "thread:delegated-task:command%3Amcp%3A950f34ee-17fa-4e2d-89d2-1cac137162e8%3Adelegate-task%3Abrowser-repro",
      "243bb14b-427e-4115-abe9-e8699e25b612",
      "tab_1",
    ]);
    const status = {
      available: true,
      visible: false,
      tabId,
      url: "https://example.com/",
      title: "Example Domain",
      loading: false,
    };
    return Effect.gen(function* () {
      const result = yield* PreviewIpc.automationStatus.handler({ tabId });
      expect(result).toEqual(status);
    }).pipe(
      Effect.provide(
        Layer.mock(PreviewManager.PreviewManager)({
          isBrowserPartition: () => false,
          automationStatus: (requestedTabId) => {
            expect(requestedTabId).toBe(tabId);
            return Effect.succeed(status);
          },
        }),
      ),
    );
  });

  effectIt.effect("rejects invalid webContents ids before resolving the preview service", () =>
    Effect.map(
      PreviewIpc.registerWebview
        .handler({ tabId: "tab-1", webContentsId: 0 })
        .pipe(Effect.provideService(PreviewManager.PreviewManager, null as never), Effect.exit),
      (exit) => {
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error) && Schema.isSchemaError(error.value)).toBe(true);
        expect(fromPartition).not.toHaveBeenCalled();
      },
    ),
  );
});
