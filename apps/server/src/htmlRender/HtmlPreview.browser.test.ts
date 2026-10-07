// @effect-diagnostics nodeBuiltinImport:off - local servers verify preview isolation.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { htmlRenderTheme } from "@t3tools/shared/htmlRender";
import { T3_CODE_DARK_THEME_COLORS } from "@t3tools/shared/themePalettes";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as NodeDgram from "node:dgram";
import * as NodeHttp from "node:http";
import * as NodeURL from "node:url";
import * as ServerConfig from "../config.ts";
import * as HtmlRender from "./HtmlRender.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
const TEST_BROWSER_ENV = "TEST_RIG_TEST_HEADLESS_SHELL";
const layerHtmlRender = (executable: string) =>
  HtmlRender.layer.pipe(
    Layer.provide(
      Layer.mock(PreviewBrowser.PreviewBrowser)({ executable: Effect.succeed(executable) }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "test-rig-preview-" })),
    Layer.provideMerge(NodeServices.layer),
  );

describe("HTML preview in Chromium", () => {
  it.live(
    "screenshots the page in headless Chrome with the requested theme and every console level",
    (ctx) =>
      Effect.gen(function* () {
        const executable = (yield* HostProcessEnvironment)[TEST_BROWSER_ENV];
        if (!executable) return ctx.skip(`Set ${TEST_BROWSER_ENV} to run this test.`);
        yield* Effect.gen(function* () {
          const htmlRender = yield* HtmlRender.HtmlRender;
          const preview = yield* htmlRender.preview({
            html: [
              '<!doctype html><html><head></head><body><div style="height:300px;background:var(--accent)"></div>',
              '<img src="/nonexistent/t3-missing.png" hidden>',
              "<script>",
              "const root = getComputedStyle(document.documentElement);",
              'console.log("ready", 3); console.info(root.getPropertyValue("--font-sans"));',
              'console.warn(root.getPropertyValue("--background")); console.error("boom");',
              "</script>",
              '<script>throw new Error("broken chart");</script>',
              "</body></html>",
            ].join(""),
            width: 400,
            appearance: "dark",
          });

          const png = Buffer.from(preview.png, "base64");
          expect(png.readUInt32BE(0)).toBe(0x89504e47);
          expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([400, 300]);
          expect(preview).toMatchObject({
            width: 400,
            contentHeight: 300,
            capturedHeight: 300,
            missingImages: ["/nonexistent/t3-missing.png"],
          });
          // Headless Chrome prefers light, so a dark background proves the theme fragment applied.
          expect(preview.consoleMessages).toEqual(
            expect.arrayContaining([
              { level: "log", text: "ready 3" },
              { level: "info", text: "Arial, Helvetica, sans-serif" },
              {
                level: "warning",
                text: htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark").variables["--background"],
              },
              { level: "error", text: "boom" },
              {
                level: "error",
                text: expect.stringMatching(/^Error: broken chart\n\s+at page\.html:1:\d+$/),
              },
            ]),
          );
        }).pipe(Effect.provide(layerHtmlRender(executable)));
      }),
    30_000,
  );

  it.live(
    "keeps every local file but the page itself out of the browser",
    (ctx) =>
      Effect.gen(function* () {
        const executable = (yield* HostProcessEnvironment)[TEST_BROWSER_ENV];
        if (!executable) return ctx.skip(`Set ${TEST_BROWSER_ENV} to run this test.`);
        yield* Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const htmlRender = yield* HtmlRender.HtmlRender;
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-html-files-" });
          const secret = path.join(directory, "secret.js");
          yield* fileSystem.writeFileString(secret, 'window.secret = "abc123";');
          const secretUrl = NodeURL.pathToFileURL(secret).href;

          const preview = yield* htmlRender.preview({
            html: [
              `<script src="${secretUrl}"></script>`,
              `<iframe src="${secretUrl}" onload="console.log('frame loaded')"></iframe>`,
              '<script>addEventListener("load", () => console.log("secret:", window.secret ?? "none"));</script>',
            ].join(""),
          });

          const texts = preview.consoleMessages.map((message) => message.text);
          expect(texts).toContain("secret: none");
          expect(texts.join(" ")).not.toContain("abc123");
        }).pipe(Effect.scoped, Effect.provide(layerHtmlRender(executable)));
      }),
    30_000,
  );

  it.live(
    "keeps the page off this machine's local network",
    (ctx) =>
      Effect.gen(function* () {
        const executable = (yield* HostProcessEnvironment)[TEST_BROWSER_ENV];
        if (!executable) return ctx.skip(`Set ${TEST_BROWSER_ENV} to run this test.`);
        // The page's connections go through a proxy that only reaches public
        // addresses, and WebRTC is gone. Each line below is a way out that
        // Chrome's own Local Network Access does not stop on its own.
        const requests: Array<string> = [];
        const server = yield* Effect.acquireRelease(
          Effect.callback<NodeHttp.Server>((resume) => {
            const listening = NodeHttp.createServer((request, response) => {
              requests.push(`${request.url} ${request.headers["sec-purpose"] ?? ""}`);
              response.end("<p>LOCAL</p>");
            });
            listening.listen(0, "127.0.0.1", () => resume(Effect.succeed(listening)));
          }),
          (listening) =>
            Effect.callback<void>((resume) => {
              listening.close(() => resume(Effect.void));
            }),
        );
        const datagrams: Array<string> = [];
        const udp = yield* Effect.acquireRelease(
          Effect.callback<NodeDgram.Socket>((resume) => {
            const socket = NodeDgram.createSocket("udp4");
            socket.on("message", (message) => datagrams.push(message.toString("hex")));
            socket.bind(0, "127.0.0.1", () => resume(Effect.succeed(socket)));
          }),
          (socket) =>
            Effect.callback<void>((resume) => {
              socket.close(() => resume(Effect.void));
            }),
        );
        const address = server.address();
        const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        const stun = `stun:127.0.0.1:${udp.address().port}`;
        yield* Effect.gen(function* () {
          const htmlRender = yield* HtmlRender.HtmlRender;
          yield* htmlRender.preview({
            html: [
              `<img src="${origin}/x.png"><iframe src="${origin}/"></iframe>`,
              `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${origin}/prefetch"]}]}</script>`,
              `<script>fetch("${origin}/").catch(() => {}); new WebSocket("ws${origin.slice(4)}/socket");`,
              `try { const peer = new RTCPeerConnection({ iceServers: [{ urls: "${stun}" }] });`,
              `peer.createDataChannel("x"); peer.createOffer().then((offer) => peer.setLocalDescription(offer));`,
              `} catch {}`,
              `window.open("${origin}/popup"); location.href = "${origin}/navigate";</script>`,
            ].join(""),
          });
        }).pipe(Effect.provide(layerHtmlRender(executable)));
        expect(requests).toEqual([]);
        expect(datagrams).toEqual([]);
      }).pipe(Effect.scoped),
    30_000,
  );
});
