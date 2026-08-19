// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("returns an empty environment for an unconfigured clone", () => {
    expect(loadRepoEnv({ baseEnv: {}, repoRoot: makeTemporaryDirectory() })).toEqual({});
  });

  it("applies root, local, then process precedence", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), "CHANNEL=root\nROOT_ONLY=yes\n");
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "CHANNEL=local\nLOCAL_ONLY=yes\n");

    expect(loadRepoEnv({ baseEnv: { CHANNEL: "process", PROCESS_ONLY: "yes" }, repoRoot })).toEqual(
      {
        CHANNEL: "process",
        ROOT_ONLY: "yes",
        LOCAL_ONLY: "yes",
        PROCESS_ONLY: "yes",
      },
    );
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sightseer-env-"));
  temporaryDirectories.push(directory);
  return directory;
}
