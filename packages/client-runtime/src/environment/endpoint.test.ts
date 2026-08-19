import { describe, expect, it } from "vite-plus/test";

import { createAdvertisedEndpoint, deriveWsBaseUrl, normalizeHttpBaseUrl } from "./endpoint.ts";

describe("advertised endpoint helpers", () => {
  it("normalizes HTTP and WebSocket base URLs", () => {
    expect(normalizeHttpBaseUrl("https://example.com/path?x=1#hash")).toBe("https://example.com/");
    expect(normalizeHttpBaseUrl("wss://example.com/socket")).toBe("https://example.com/");
    expect(deriveWsBaseUrl("https://example.com/api")).toBe("wss://example.com/");
    expect(deriveWsBaseUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/");
  });

  it("creates provider-neutral endpoint records", () => {
    expect(
      createAdvertisedEndpoint({
        id: "lan:http://192.168.1.44:3773",
        label: "LAN",
        httpBaseUrl: "http://192.168.1.44:3773",
        reachability: "lan",
        isDefault: true,
      }),
    ).toEqual({
      id: "lan:http://192.168.1.44:3773",
      label: "LAN",
      httpBaseUrl: "http://192.168.1.44:3773/",
      wsBaseUrl: "ws://192.168.1.44:3773/",
      reachability: "lan",
      status: "available",
      isDefault: true,
    });
  });
});
