import { describe, expect, it } from "vite-plus/test";

import { faviconUrlForOrigin } from "./favicon.ts";
import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
} from "./hostClassification.ts";

describe("private host classification", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("retains loopback classification for %s", (host) => {
    expect(isLocalLoopbackHost(host)).toBe(true);
    expect(isPrivateNetworkHost(host)).toBe(true);
  });

  it.each(["10.0.0.5", "192.168.1.4", "desktop.local", "server.home.arpa", "server"])(
    "retains explicit local-network hostname classification for %s",
    (host) => {
      expect(isPrivateNetworkHost(host)).toBe(true);
    },
  );

  it("classifies a tailnet hostname privately without generating favicon requests", () => {
    const host = "desktop.example.ts.net";
    expect(isPrivateNetworkHost(host)).toBe(true);
    expect(isPublicFaviconHost(host)).toBe(false);
    expect(faviconUrlForOrigin(`https://${host}/private`)).toBeNull();
  });

  it("keeps public-origin favicons on that origin", () => {
    expect(faviconUrlForOrigin("https://example.com/project")).toBe(
      "https://example.com/favicon.ico",
    );
  });
});
