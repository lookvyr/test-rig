import type { PreviewAutomationSnapshot } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export const MAX_SNAPSHOT_TEXT_BYTES = 60_000;

/** Keep the same bounded metadata in text and structured MCP results. */
export function snapshotMetadata(snapshot: PreviewAutomationSnapshot, screenshotPath?: string) {
  const omitted = new Set<string>(["accessibilityTree (use selectors or preview_evaluate)"]);
  const cut = (value: string, max: number, label: string): string => {
    if (value.length <= max) return value;
    omitted.add(`${label} after ${max} characters`);
    return `${value.slice(0, max)}…`;
  };
  const logs = <T extends object>(entries: readonly T[], label: string): T[] => {
    if (entries.length > 40) omitted.add(`older ${label}`);
    return entries
      .slice(-40)
      .map(
        (entry) =>
          Object.fromEntries(
            Object.entries(entry).map(([key, value]) => [
              key,
              typeof value === "string" ? cut(value, 500, `${label} strings`) : value,
            ]),
          ) as T,
      );
  };
  const metadata = {
    url: cut(snapshot.url, 2_048, "url"),
    title: cut(snapshot.title, 2_048, "title"),
    loading: snapshot.loading,
    visibleText: cut(snapshot.visibleText, 8_000, "visibleText"),
    interactiveElements: snapshot.interactiveElements.map((element) => ({
      ...element,
      name: cut(element.name, 200, "element names"),
    })),
    consoleEntries: logs(snapshot.consoleEntries, "console entries"),
    networkEntries: logs(snapshot.networkEntries, "network entries"),
    actionTimeline: logs(snapshot.actionTimeline, "action timeline entries"),
    screenshot: {
      mimeType: snapshot.screenshot.mimeType,
      width: snapshot.screenshot.width,
      height: snapshot.screenshot.height,
    },
    ...(screenshotPath === undefined
      ? {}
      : {
          screenshotPath,
          screenshotMarkdown: `![Browser screenshot](/browser-artifacts/${screenshotPath.split(/[\\/]/).at(-1)})`,
        }),
  };
  const result = () => ({ ...metadata, omitted: [...omitted] });
  const newestHalf = <T>(entries: T[]): T[] => entries.slice(Math.ceil(entries.length / 2));

  // Shed logs before selectors. Never shorten a selector into an invalid target.
  // Count the encoded JSON, including omission notes and escaping, in the limit.
  while (Buffer.byteLength(JSON.stringify(result()), "utf8") > MAX_SNAPSHOT_TEXT_BYTES) {
    if (metadata.actionTimeline.length > 0) {
      metadata.actionTimeline = newestHalf(metadata.actionTimeline);
      omitted.add("older action timeline entries (size limit)");
    } else if (metadata.networkEntries.length > 0) {
      metadata.networkEntries = newestHalf(metadata.networkEntries);
      omitted.add("older network entries (size limit)");
    } else if (metadata.consoleEntries.length > 0) {
      metadata.consoleEntries = newestHalf(metadata.consoleEntries);
      omitted.add("older console entries (size limit)");
    } else if (metadata.interactiveElements.length > 0) {
      metadata.interactiveElements = metadata.interactiveElements.slice(
        0,
        Math.floor(metadata.interactiveElements.length / 2),
      );
      omitted.add("interactive elements (size limit)");
    } else {
      // JSON escaping can expand page text beyond its character cap.
      metadata.visibleText = metadata.visibleText.slice(
        0,
        Math.floor(metadata.visibleText.length / 2),
      );
      omitted.add("visibleText (size limit)");
    }
  }
  return result();
}

export class PreviewScreenshotSaveError extends Schema.TaggedErrorClass<PreviewScreenshotSaveError>()(
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
