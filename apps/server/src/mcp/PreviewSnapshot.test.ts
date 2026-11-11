import { expect, it } from "@effect/vitest";
import type { PreviewAutomationSnapshot } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import {
  MAX_SNAPSHOT_TEXT_BYTES,
  saveScreenshot,
  savedScreenshotMetadata,
  snapshotMetadata,
} from "./PreviewSnapshot.ts";

const tree = `- heading "Example" [level=1]
- button "Continue" [ref=t3-abc-e2]`;

const snapshot: PreviewAutomationSnapshot = {
  url: "https://example.test",
  title: "Example",
  loading: false,
  visibleText: "Example page",
  interactiveElements: [],
  accessibilityTree: tree,
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: { mimeType: "image/png", data: "cG5n", width: 100, height: 50 },
};

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

it("returns the tree's refs and screenshot size, leaving out image bytes and empty lists", () => {
  const result = snapshotMetadata(snapshot);
  expect(result).toEqual({
    url: "https://example.test",
    title: "Example",
    loading: false,
    visibleText: "Example page",
    accessibilityTree: tree,
    screenshot: { mimeType: "image/png", width: 100, height: 50 },
  });
});

it("notes a tree it cannot pass through", () => {
  const result = snapshotMetadata({ ...snapshot, accessibilityTree: { nodes: [] } });
  expect(result).not.toHaveProperty("accessibilityTree");
  expect(result.omitted).toEqual([
    "accessibilityTree (use interactiveElements locators or preview_evaluate)",
  ]);
});

it("lists only console errors, failed requests, and actions that did not succeed", () => {
  const result = snapshotMetadata({
    ...snapshot,
    consoleEntries: [
      { level: "log", text: "ready", timestamp: "1" },
      { level: "error", text: "boom", timestamp: "2" },
      { level: "warning", text: "deprecated", timestamp: "3" },
    ],
    networkEntries: [
      { url: "https://example.test/ok", method: "GET", status: 200, failed: false, timestamp: "1" },
      {
        url: "https://example.test/missing",
        method: "GET",
        status: 404,
        failed: false,
        timestamp: "2",
      },
      {
        url: "https://example.test/offline",
        method: "GET",
        status: null,
        failed: true,
        errorText: "net::ERR_FAILED",
        timestamp: "3",
      },
    ],
    actionTimeline: [
      { id: "1", action: "click", status: "succeeded", startedAt: "1" },
      { id: "2", action: "type", status: "failed", startedAt: "2", error: "detached" },
    ],
  });
  expect(result.consoleEntries?.map(({ text }) => text)).toEqual(["boom", "deprecated"]);
  expect(result.networkEntries?.map(({ url }) => url)).toEqual([
    "https://example.test/missing",
    "https://example.test/offline",
  ]);
  expect(result.actionTimeline?.map(({ id }) => id)).toEqual(["2"]);
});

it("keeps the newest errors when there are many", () => {
  const result = snapshotMetadata({
    ...snapshot,
    consoleEntries: Array.from({ length: 100 }, (_, index) => ({
      level: "error",
      text: `message ${index}`,
      timestamp: String(index),
    })),
  });
  expect(result.consoleEntries).toHaveLength(40);
  expect(result.consoleEntries?.[0]?.text).toBe("message 60");
  expect(result.consoleEntries?.at(-1)?.text).toBe("message 99");
  expect(result.omitted).toContain("60 older console errors");
});

it("bounds Unicode and escaped JSON, shedding logs before page text and refs", () => {
  const large = snapshotMetadata({
    ...snapshot,
    title: "\u0000".repeat(20_000),
    url: "\u0000".repeat(20_000),
    visibleText: "\u0000".repeat(30_000),
    consoleEntries: Array.from({ length: 100 }, (_, index) => ({
      level: "error",
      text: "文".repeat(5_000),
      timestamp: `entry-${index}`,
    })),
    networkEntries: Array.from({ length: 100 }, (_, index) => ({
      url: `https://example.test/${"x".repeat(5_000)}`,
      method: "GET",
      status: 500,
      failed: false,
      timestamp: `entry-${index}`,
    })),
    accessibilityTree: `- button "Continue" [ref=t3-abc-e2]\n${'- link "🙂" [ref=t3-abc-e3]\n'.repeat(5_000)}`,
  });
  expect(bytes(large)).toBeLessThanOrEqual(MAX_SNAPSHOT_TEXT_BYTES);
  expect(large.accessibilityTree).toMatch(/^- button "Continue" \[ref=t3-abc-e2\]/);
  expect(large.consoleEntries).toBeUndefined();
  expect(large.networkEntries).toBeUndefined();
  expect(large.omitted).toContain("40 of 40 consoleEntries");
  expect(large.omitted?.some((note) => note.startsWith("accessibilityTree after"))).toBe(true);
});

it("keeps page text beside a large tree", () => {
  const result = snapshotMetadata({
    ...snapshot,
    visibleText: "word ".repeat(4_000),
    accessibilityTree: '- link "x" [ref=t3-abc-e1]\n'.repeat(4_000),
  });
  expect(bytes(result)).toBeLessThanOrEqual(MAX_SNAPSHOT_TEXT_BYTES);
  expect(result.visibleText.length).toBeGreaterThanOrEqual(2_000);
  expect(result.accessibilityTree?.length).toBeGreaterThanOrEqual(2_000);
});

it("never cuts an emoji in half", () => {
  const result = snapshotMetadata({
    ...snapshot,
    visibleText: `a${"🙂".repeat(10_000)}`,
    accessibilityTree: `b${"🙂".repeat(20_000)}`,
  });
  const text = JSON.stringify(result);
  expect(text).not.toMatch(/\\ud83d(?!\\ude42)/i);
  expect(`${result.visibleText}${result.accessibilityTree}`).not.toMatch(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
  );
});

it("returns only the path and markdown for a saved screenshot", () => {
  expect(
    savedScreenshotMetadata("https://example.test", "/tmp/a/browser-screenshot-x.png"),
  ).toEqual({
    url: "https://example.test",
    screenshotPath: "/tmp/a/browser-screenshot-x.png",
    screenshotMarkdown: "![Browser screenshot](/browser-artifacts/browser-screenshot-x.png)",
  });
});

it.effect("saves distinct PNG files even when snapshots have the same timestamp", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const data = new Uint8Array([137, 80, 78, 71]);
    const first = yield* saveScreenshot("https://example.test/path?private=value", data);
    const second = yield* saveScreenshot("https://example.test/path?private=value", data);
    expect(first).not.toBe(second);
    expect(first).toMatch(/browser-screenshot-example-test-[a-z0-9-]+\.png$/);
    expect(first).not.toContain("private");
    expect(Array.from(yield* fs.readFile(first))).toEqual(Array.from(data));
    expect(Array.from(yield* fs.readFile(second))).toEqual(Array.from(data));
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "test-rig-screenshot-save-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
