import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { resolveWorktreesDirectory } from "./worktreesDirectory.ts";

const path = NodePath as unknown as Parameters<typeof resolveWorktreesDirectory>[2];

describe("resolveWorktreesDirectory", () => {
  it("uses the default for an empty setting and accepts folders inside home", () => {
    expect(resolveWorktreesDirectory("", "/default", path, "/Users/me")).toBe("/default");
    expect(resolveWorktreesDirectory("/Users/me/worktrees", "/default", path, "/Users/me")).toBe(
      "/Users/me/worktrees",
    );
  });
  it("rejects roots, relative paths, and the home folder or its parents", () => {
    expect(resolveWorktreesDirectory("/", "/default", path, "/Users/me")).toBeNull();
    expect(resolveWorktreesDirectory("worktrees", "/default", path, "/Users/me")).toBeNull();
    expect(resolveWorktreesDirectory("/Users/me", "/default", path, "/Users/me")).toBeNull();
    expect(resolveWorktreesDirectory("/Users", "/default", path, "/Users/me")).toBeNull();
  });
});
