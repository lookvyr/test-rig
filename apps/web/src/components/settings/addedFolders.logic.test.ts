import { describe, expect, it } from "vite-plus/test";

import { resolveAddedFolder } from "./addedFolders.logic";

describe("resolveAddedFolder", () => {
  const overflowingPath = `/srv/${"a".repeat(127)}🚀`;
  const paddedPath = `/srv/${" ".repeat(127)}🚀`;

  it.each([
    [
      "an absolute path with a trailing slash",
      "  /srv/repos/tools/ ",
      { path: "/srv/repos/tools", name: "tools" },
    ],
    ["a Windows drive path", "C:\\Work\\lib\\", { path: "C:\\Work\\lib", name: "lib" }],
    [
      "an emoji crossing the name limit",
      overflowingPath,
      { path: overflowingPath, name: "a".repeat(127) },
    ],
    [
      "an emoji after leading whitespace at the limit",
      paddedPath,
      { path: paddedPath, name: "🚀" },
    ],
    [
      "a directory name longer than a folder name may be",
      `/srv/${"n".repeat(127)} ${"x".repeat(40)}`,
      { path: `/srv/${"n".repeat(127)} ${"x".repeat(40)}`, name: "n".repeat(127) },
    ],
  ])("resolves %s", (_label, path, expected) => {
    expect(resolveAddedFolder(path)).toEqual(expected);
  });

  it("keeps a given name, capped", () => {
    expect(resolveAddedFolder("/srv/lib", ` ${"z".repeat(200)}`)).toEqual({
      path: "/srv/lib",
      name: "z".repeat(128),
    });
  });

  it.each(["", "   ", "relative/path", "~/code", "./lib"])("rejects %j", (path) => {
    expect(resolveAddedFolder(path)).toBeNull();
  });
});
