import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { HttpServerResponse } from "effect/unstable/http";
import { HTML_RENDER_ESCAPE_MESSAGE } from "@t3tools/shared/htmlRender";

import {
  assetFileResponse,
  assetResponseHeaders,
  isLoopbackHostname,
  resolveDevRedirectUrl,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("HTML asset sandbox", () => {
  it.effect(
    "serves saved visualizations with Escape support while keeping downloads unchanged",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* fs.makeTempFileScoped({ suffix: ".html" });
        const html =
          '<!doctype html><html><head></head><body><input value="Saved page"></body></html>';
        yield* fs.writeFileString(path, html);
        const inline = yield* assetFileResponse({ path, htmlRender: true });
        const web = HttpServerResponse.toWeb(inline);
        expect(yield* Effect.promise(() => web.text())).toContain(HTML_RENDER_ESCAPE_MESSAGE);
        expect(web.headers.get("content-security-policy")).toBe(
          assetResponseHeaders(path)["Content-Security-Policy"],
        );
        const download = yield* assetFileResponse({ path, htmlRender: true, download: true });
        expect(yield* Effect.promise(() => HttpServerResponse.toWeb(download).text())).toBe(html);
        expect(yield* fs.readFileString(path)).toBe(html);
        const head = yield* assetFileResponse(
          { path, htmlRender: true },
          undefined,
          undefined,
          "HEAD",
        );
        expect(yield* Effect.promise(() => HttpServerResponse.toWeb(head).text())).toBe("");
      }).pipe(Effect.provide(NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );
  it("allows downloads without allowing modals or same-origin access", () => {
    for (const headers of [
      assetResponseHeaders("page.html"),
      assetResponseHeaders("attachment", { mimeType: "text/html" }),
    ]) {
      const sandbox = headers["Content-Security-Policy"]?.split(" ");
      expect(sandbox).toContain("sandbox");
      expect(sandbox).toContain("allow-downloads");
      expect(sandbox).not.toContain("allow-modals");
      expect(sandbox).not.toContain("allow-same-origin");
    }
  });
});
