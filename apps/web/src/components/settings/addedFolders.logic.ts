import type { ProjectAddedFolder } from "@t3tools/contracts";
import {
  fileBasename,
  isWindowsAbsolutePath,
  normalizeProjectPathForDispatch,
} from "@t3tools/shared/path";

/** Whether cutting `text` at `offset` would split an emoji (a UTF-16 surrogate pair) in two. */
function splitsSurrogatePair(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** `ProjectAddedFolder.name` takes at most this many characters. */
const ADDED_FOLDER_NAME_MAX = 128;

/**
 * The folder a project adds for a typed or picked path, named after its last segment unless a
 * name is given. Null when the path is not absolute, so a relative path is never sent.
 */
export function resolveAddedFolder(rawPath: string, rawName?: string): ProjectAddedFolder | null {
  const path = normalizeProjectPathForDispatch(rawPath);
  if (path.length === 0 || !(path.startsWith("/") || isWindowsAbsolutePath(path))) return null;
  const full = (rawName ?? fileBasename(path)).trimStart();
  // Cut before an emoji's second half rather than through it.
  const end = splitsSurrogatePair(full, ADDED_FOLDER_NAME_MAX)
    ? ADDED_FOLDER_NAME_MAX - 1
    : ADDED_FOLDER_NAME_MAX;
  const name = full.slice(0, end).trimEnd();
  return name.length === 0 ? null : { path, name };
}
