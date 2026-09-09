import { expect, it } from "@effect/vitest";
import type { PreviewAutomationSnapshot } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { MAX_SNAPSHOT_TEXT_BYTES, saveScreenshot, snapshotMetadata } from "./PreviewSnapshot.ts";

const snapshot: PreviewAutomationSnapshot = {
  url: "https://example.test",
  title: "Example",
  loading: false,
  visibleText: "Example page",
  interactiveElements: [
    {
      tag: "button",
      role: "button",
      name: "Continue",
      selector: "#continue",
      x: 10,
      y: 20,
      width: 100,
      height: 30,
    },
  ],
  accessibilityTree: { nodes: ["full accessibility tree"] },
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: { mimeType: "image/png", data: "cG5n", width: 100, height: 50 },
};

it("keeps actionable selectors and screenshot metadata without duplicating image bytes", () => {
  const result = snapshotMetadata(snapshot);
  expect(result.interactiveElements).toEqual(snapshot.interactiveElements);
  expect(result.screenshot).toEqual({ mimeType: "image/png", width: 100, height: 50 });
  expect(result).not.toHaveProperty("accessibilityTree");
  expect(result).not.toHaveProperty("screenshotPath");
  expect(result.omitted).toContain("accessibilityTree (use selectors or preview_evaluate)");
});

it("bounds Unicode and escaped JSON while keeping recent diagnostics and intact selectors", () => {
  const large = snapshotMetadata({
    ...snapshot,
    title: "\u0000".repeat(20_000),
    url: "\u0000".repeat(20_000),
    visibleText: "\u0000".repeat(30_000),
    interactiveElements: Array.from({ length: 200 }, (_, index) => ({
      ...snapshot.interactiveElements[0]!,
      name: "🙂".repeat(10_000),
      selector: `#button-${index}`,
    })),
    consoleEntries: Array.from({ length: 100 }, (_, index) => ({
      level: "log",
      text: "文".repeat(5_000),
      timestamp: `entry-${index}`,
    })),
    networkEntries: Array.from({ length: 100 }, (_, index) => ({
      url: `https://example.test/${"x".repeat(5_000)}`,
      method: "GET",
      status: 200,
      failed: false,
      timestamp: `entry-${index}`,
    })),
    accessibilityTree: "tree".repeat(100_000),
  });
  expect(Buffer.byteLength(JSON.stringify(large), "utf8")).toBeLessThanOrEqual(
    MAX_SNAPSHOT_TEXT_BYTES,
  );
  expect(large.interactiveElements.every(({ selector }) => /^#button-\d+$/.test(selector))).toBe(
    true,
  );
  expect(large.omitted).toContain("visibleText (size limit)");
  expect(large.omitted).toContain("older console entries");
  const recent = snapshotMetadata({
    ...snapshot,
    consoleEntries: Array.from({ length: 100 }, (_, index) => ({
      level: "log",
      text: `message ${index}`,
      timestamp: String(index),
    })),
  });
  expect(recent.consoleEntries).toHaveLength(40);
  expect(recent.consoleEntries[0]?.text).toBe("message 60");
  expect(recent.consoleEntries.at(-1)?.text).toBe("message 99");
});

it("drops oversized selectors instead of returning shortened selectors that could target another element", () => {
  const result = snapshotMetadata({
    ...snapshot,
    interactiveElements: [
      { ...snapshot.interactiveElements[0]!, selector: `#${"x".repeat(100_000)}` },
    ],
  });
  expect(result.interactiveElements).toEqual([]);
  expect(result.omitted).toContain("interactive elements (size limit)");
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
    MAX_SNAPSHOT_TEXT_BYTES,
  );
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
