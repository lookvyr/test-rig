import { describe, expect, it } from "vite-plus/test";

import { resolvePreviewAddress } from "./previewAddress";

describe("resolvePreviewAddress", () => {
  it.each([
    "react",
    " responsive design examples ",
    "C++ & CSS #examples",
    "日本語 café",
    "site:react.dev",
    "site:react.dev useEffect",
    "how to use https://example.com",
  ])("searches for %s without losing query characters", (input) => {
    const result = new URL(resolvePreviewAddress(input));
    expect(result.origin + result.pathname).toBe("https://www.google.com/search");
    expect([...result.searchParams]).toEqual([["q", input.trim()]]);
    expect(result.hash).toBe("");
  });

  it.each([
    ["example.com", "https://example.com/"],
    ["example.com/docs?q=a&b=2#heading", "https://example.com/docs?q=a&b=2#heading"],
    [" localhost:5173/app ", "http://localhost:5173/app"],
    ["LOCALHOST:3000", "http://localhost:3000/"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/"],
    ["[::1]:5173", "http://[::1]:5173/"],
    ["192.168.1.10:8080", "https://192.168.1.10:8080/"],
    ["intranet:8080/path", "https://intranet:8080/path"],
    ["https://intranet/path", "https://intranet/path"],
    ["user:secret@example.com/private", "https://user:secret@example.com/private"],
    ["user:secret@intranet/private", "https://user:secret@intranet/private"],
    ["https://example.com/my notes", "https://example.com/my%20notes"],
  ])("navigates directly to %s", (input, expected) => {
    expect(resolvePreviewAddress(input)).toBe(expected);
  });

  it.each([
    "",
    "https://",
    "http:example.com",
    "https://example.com:bad/private?token=secret",
    "user:secret@example.com:bad/private",
    "localhost:bad",
    "example.com:bad",
    "ftp://example.com",
    "file:///tmp/page.html",
    "javascript:alert(1)",
    "data:text/html,hello",
  ])("rejects an invalid or unsupported address instead of searching for it: %s", (input) => {
    expect(() => resolvePreviewAddress(input)).toThrow();
  });
});
