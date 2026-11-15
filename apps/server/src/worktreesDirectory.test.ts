import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveWorktreesDirectory } from "./worktreesDirectory.ts";

it.layer(NodeServices.layer)("resolveWorktreesDirectory", (it) => {
  it.effect("uses the default for an empty setting and accepts folders inside home", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(resolveWorktreesDirectory("", "/default", path, "/Users/me"), "/default");
      assert.equal(
        resolveWorktreesDirectory("/Users/me/worktrees", "/default", path, "/Users/me"),
        "/Users/me/worktrees",
      );
    }),
  );
  it.effect("rejects roots, relative paths, and the home folder or its parents", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.isNull(resolveWorktreesDirectory("/", "/default", path, "/Users/me"));
      assert.isNull(resolveWorktreesDirectory("worktrees", "/default", path, "/Users/me"));
      assert.isNull(resolveWorktreesDirectory("/Users/me", "/default", path, "/Users/me"));
      assert.isNull(resolveWorktreesDirectory("/Users", "/default", path, "/Users/me"));
    }),
  );
});
