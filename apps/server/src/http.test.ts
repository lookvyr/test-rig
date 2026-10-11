import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { assetResponseHeaders, isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";

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
