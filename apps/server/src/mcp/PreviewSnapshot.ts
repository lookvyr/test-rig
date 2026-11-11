import type { PreviewAutomationSnapshot } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

/** Claude Code spills oversized results to files, losing locators; bound both text and its preferred structuredContent. */
export const MAX_SNAPSHOT_TEXT_BYTES = 20_000;
const MAX_VISIBLE_TEXT_CHARS = 8_000;
const MAX_TREE_CHARS = 20_000;
// Page text and the ARIA tree both shrink to this before either drops below it.
const TEXT_FLOOR_CHARS = 2_000;
const MAX_ELEMENT_NAME_CHARS = 200;
const MAX_LOG_ENTRIES = 40;
const MAX_LOG_TEXT_CHARS = 500;
const MAX_IDENTIFIER_CHARS = 2_048;
const IDENTIFIER_FLOOR_CHARS = 256;
const ERROR_CONSOLE_LEVELS = new Set(["error", "warning", "assert"]);

const cutText = (text: string, max: number) => {
  if (text.length <= max) return text;
  // Half an emoji serializes to a lone surrogate escape, which provider JSON parsers reject.
  const last = text.charCodeAt(max - 1);
  return `${text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)}…`;
};

/** A cut inside a ref's digits would leave a live ref for another element, so cut between lines. */
const cutTree = (tree: string, max: number) => {
  if (tree.length <= max) return tree;
  const end = tree.lastIndexOf("\n", max);
  return end <= 0 ? "" : `${tree.slice(0, end)}\n…`;
};

const halveToFloor = (chars: number) =>
  chars > TEXT_FLOOR_CHARS
    ? Math.max(TEXT_FLOOR_CHARS, Math.floor(chars / 2))
    : Math.floor(chars / 2);

const cutEntryStrings = <A extends object>(entry: A): A =>
  Object.fromEntries(
    Object.entries(entry).map(([key, value]) => [
      key,
      typeof value === "string" ? cutText(value, MAX_LOG_TEXT_CHARS) : value,
    ]),
  ) as A;

const screenshotMarkdown = (screenshotPath: string) =>
  `![Browser screenshot](/browser-artifacts/${screenshotPath.split(/[\\/]/).at(-1)})`;

/** A save is for showing people the page, so its result skips the page state. */
export const savedScreenshotMetadata = (url: string, screenshotPath: string) => ({
  url: cutText(url, MAX_IDENTIFIER_CHARS),
  screenshotPath,
  screenshotMarkdown: screenshotMarkdown(screenshotPath),
});

/**
 * Bounded snapshot metadata for both the text and structured MCP results. Successful requests,
 * routine console output, and finished actions repeat on every snapshot, so logs list problems only.
 */
export function snapshotMetadata(snapshot: PreviewAutomationSnapshot, screenshotPath?: string) {
  const omitted: string[] = [];
  const tree =
    typeof snapshot.accessibilityTree === "string" ? snapshot.accessibilityTree : undefined;
  if (snapshot.accessibilityTree !== undefined && tree === undefined) {
    omitted.push("accessibilityTree (use interactiveElements locators or preview_evaluate)");
  }
  const tail = <T extends object>(entries: readonly T[], label: string): T[] => {
    if (entries.length > MAX_LOG_ENTRIES) {
      omitted.push(`${entries.length - MAX_LOG_ENTRIES} older ${label}`);
    }
    return entries.slice(-MAX_LOG_ENTRIES).map(cutEntryStrings);
  };
  let identifierChars = MAX_IDENTIFIER_CHARS;
  const bounded = {
    loading: snapshot.loading,
    screenshot: {
      mimeType: snapshot.screenshot.mimeType,
      width: snapshot.screenshot.width,
      height: snapshot.screenshot.height,
    },
    ...(screenshotPath === undefined
      ? {}
      : {
          screenshotPath,
          screenshotMarkdown: screenshotMarkdown(screenshotPath),
        }),
  };
  const shedOrder = [
    "actionTimeline",
    "networkEntries",
    "consoleEntries",
    "interactiveElements",
  ] as const;
  type ListKey = (typeof shedOrder)[number];
  type Lists = { readonly [K in ListKey]: PreviewAutomationSnapshot[K] };
  const full: Lists = {
    interactiveElements: snapshot.interactiveElements.map((element) => ({
      ...element,
      name: cutText(element.name, MAX_ELEMENT_NAME_CHARS),
    })),
    consoleEntries: tail(
      snapshot.consoleEntries.filter((entry) => ERROR_CONSOLE_LEVELS.has(entry.level)),
      "console errors",
    ),
    networkEntries: tail(
      snapshot.networkEntries.filter(
        (entry) => entry.failed || (entry.status !== null && entry.status >= 400),
      ),
      "failed requests",
    ),
    actionTimeline: tail(
      snapshot.actionTimeline.filter((entry) => entry.status !== "succeeded"),
      "unfinished or failed actions",
    ),
  };
  const lists: { -readonly [K in ListKey]: Lists[K] } = { ...full };
  const nonEmpty = <K extends ListKey>(key: K): { [P in K]?: Lists[K] } =>
    lists[key].length > 0 ? ({ [key]: lists[key] } as { [P in K]?: Lists[K] }) : {};
  let visibleTextChars = Math.min(snapshot.visibleText.length, MAX_VISIBLE_TEXT_CHARS);
  let treeChars = Math.min(tree?.length ?? 0, MAX_TREE_CHARS);
  // Empty lists are left out: an agent learns nothing from them, and they repeat every call.
  const value = () => ({
    url: cutText(snapshot.url, identifierChars),
    title: cutText(snapshot.title, identifierChars),
    ...bounded,
    visibleText: cutText(snapshot.visibleText, visibleTextChars),
    ...(tree === undefined || treeChars === 0
      ? {}
      : { accessibilityTree: cutTree(tree, treeChars) }),
    ...nonEmpty("interactiveElements"),
    ...nonEmpty("consoleEntries"),
    ...nonEmpty("networkEntries"),
    ...nonEmpty("actionTimeline"),
    ...(omitted.length === 0 ? {} : { omitted }),
  });
  const shed = <K extends ListKey>(key: K) => {
    const entries: ReadonlyArray<unknown> = lists[key];
    const keep = Math.floor(entries.length / 2);
    // Elements keep page order from the top; logs keep their newest entries.
    lists[key] = (key === "interactiveElements"
      ? entries.slice(0, keep)
      : entries.slice(entries.length - keep)) as unknown as Lists[K];
  };
  const size = () => Buffer.byteLength(JSON.stringify(value()), "utf8");
  while (size() > MAX_SNAPSHOT_TEXT_BYTES) {
    // Logs shed first, oldest first. Below the floors, locator-bearing elements and tree go last.
    const key =
      shedOrder.find(
        (candidate) => candidate !== "interactiveElements" && lists[candidate].length > 0,
      ) ??
      (visibleTextChars > TEXT_FLOOR_CHARS
        ? "visibleText"
        : treeChars > TEXT_FLOOR_CHARS
          ? "accessibilityTree"
          : identifierChars > IDENTIFIER_FLOOR_CHARS
            ? "identifiers"
            : visibleTextChars > 0
              ? "visibleText"
              : lists.interactiveElements.length > 0
                ? "interactiveElements"
                : treeChars > 0
                  ? "accessibilityTree"
                  : identifierChars > 0
                    ? "identifiers"
                    : undefined);
    if (key === undefined) break;
    if (key === "visibleText") visibleTextChars = halveToFloor(visibleTextChars);
    else if (key === "accessibilityTree") treeChars = halveToFloor(treeChars);
    else if (key === "identifiers") identifierChars = Math.floor(identifierChars / 2);
    else shed(key);
  }
  // Notes are added after shedding, so measure once more and trim page text if they tipped it over.
  const notes = () => {
    omitted.length = baseNotes;
    if (snapshot.url.length > identifierChars || snapshot.title.length > identifierChars) {
      omitted.push(`url or title after ${identifierChars} characters`);
    }
    if (visibleTextChars < snapshot.visibleText.length) {
      omitted.push(
        `visibleText after ${visibleTextChars} characters (use preview_evaluate for more)`,
      );
    }
    if (tree !== undefined && treeChars < tree.length) {
      omitted.push(`accessibilityTree after ${treeChars} characters`);
    }
    for (const key of shedOrder) {
      const dropped = full[key].length - lists[key].length;
      if (dropped > 0) omitted.push(`${dropped} of ${full[key].length} ${key}`);
    }
  };
  const baseNotes = omitted.length;
  notes();
  while (size() > MAX_SNAPSHOT_TEXT_BYTES && (visibleTextChars > 0 || identifierChars > 0)) {
    if (visibleTextChars > 0) visibleTextChars = Math.floor(visibleTextChars / 2);
    else identifierChars = Math.floor(identifierChars / 2);
    notes();
  }
  return value();
}

export class PreviewScreenshotSaveError extends Schema.TaggedError<PreviewScreenshotSaveError>()(
  "PreviewScreenshotSaveError",
  { screenshotPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not save the browser screenshot.";
  }
}

function screenshotSiteSlug(rawUrl: string): string {
  try {
    return (
      new URL(rawUrl).hostname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)
        .replace(/^-+|-+$/g, "") || "site"
    );
  } catch {
    return "site";
  }
}

export const saveScreenshot = Effect.fn("PreviewSnapshot.saveScreenshot")(function* (
  pageUrl: string,
  data: Uint8Array,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const millis = yield* Clock.currentTimeMillis;
  const id = yield* crypto.randomUUIDv4;
  const fileName = `browser-screenshot-${screenshotSiteSlug(pageUrl)}-${millis.toString(36)}-${id}.png`;
  const screenshotPath = path.join(config.browserArtifactsDir, fileName);
  yield* fileSystem.makeDirectory(config.browserArtifactsDir, { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFile(screenshotPath, data, { flag: "wx" })),
    Effect.mapError((cause) => new PreviewScreenshotSaveError({ screenshotPath, cause })),
  );
  return screenshotPath;
});
