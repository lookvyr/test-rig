import * as NodeCrypto from "node:crypto";
import type { ThreadId } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";

/** One stable, server-owned folder for a Scratch thread, including its draft. */
export const makePrepareScratchWorkspace = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  return Effect.fn("prepareScratchWorkspace")(function* (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot: string;
    readonly worktreePath: string | null;
  }) {
    const scratchRoot = path.resolve(config.baseDir, "scratch");
    if (
      input.worktreePath !== null ||
      normalizeProjectPathForComparison(input.workspaceRoot) !==
        normalizeProjectPathForComparison(scratchRoot)
    ) {
      return input.worktreePath;
    }
    // Hash the full id so arbitrary ids cannot escape or collide after sanitizing.
    const folder = path.join(
      scratchRoot,
      NodeCrypto.createHash("sha256").update(input.threadId).digest("hex").slice(0, 24),
    );
    yield* fs.makeDirectory(folder, { recursive: true });
    return folder;
  });
});
