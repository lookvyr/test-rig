import * as NodeOS from "node:os";
import type * as Path from "effect/Path";

import { expandHomePathWith } from "./pathExpansion.ts";

/**
 * Null for filesystem roots, the home folder and its parents, or settings not absolute on this
 * host. Everything under a worktree folder is treated as Test Rig's to clean, so a folder that
 * holds the user's own files is never accepted.
 */
export function resolveWorktreesDirectory(
  setting: string,
  defaultDir: string,
  path: Path.Path,
  home: string = NodeOS.homedir(),
): string | null {
  if (setting === "") return defaultDir;
  const expanded = expandHomePathWith(setting, path);
  if (!path.isAbsolute(expanded)) return null;
  const resolved = path.resolve(expanded);
  if (isFilesystemRoot(resolved, path)) return null;
  const relativeHome = path.relative(resolved, path.resolve(home));
  const containsHome = relativeHome === "" || !relativeHome.startsWith("..");
  return containsHome ? null : resolved;
}

/** Callers re-check after resolving symlinks: a link can point at a root. */
export function isFilesystemRoot(directory: string, path: Path.Path): boolean {
  return path.dirname(directory) === directory;
}

/** The default folder, the configured one, and every folder it was moved away from. */
export function managedWorktreesDirectories(
  settings: {
    readonly worktreesDirectory: string;
    readonly previousWorktreesDirectories: ReadonlyArray<string>;
  },
  defaultDir: string,
  path: Path.Path,
): ReadonlyArray<string> {
  const directories = new Set([defaultDir]);
  for (const setting of [settings.worktreesDirectory, ...settings.previousWorktreesDirectories]) {
    const directory = resolveWorktreesDirectory(setting, defaultDir, path);
    if (directory !== null) directories.add(directory);
  }
  return [...directories];
}
