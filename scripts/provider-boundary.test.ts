// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

function productionTypeScriptFiles(root: string): string[] {
  return NodeFS.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "dist" || entry.name === "node_modules"
        ? []
        : productionTypeScriptFiles(path);
    }
    return /\.[cm]?[jt]sx?$/u.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("executable provider boundary", () => {
  it("contains no excluded provider or ACP server implementation", () => {
    const removedPaths = [
      "apps/server/src/provider/Drivers/CursorDriver.ts",
      "apps/server/src/provider/Drivers/GrokDriver.ts",
      "apps/server/src/provider/acp/AcpSessionRuntime.ts",
      "packages/effect-acp/package.json",
    ];

    expect(removedPaths.filter((path) => NodeFS.existsSync(NodePath.join(repoRoot, path)))).toEqual(
      [],
    );

    const forbiddenNeedles = ["cursor-agent", '"grok"', "effect-acp", "provider/acp"];
    const violations = productionTypeScriptFiles(NodePath.join(repoRoot, "apps/server")).flatMap(
      (file) => {
        const contents = NodeFS.readFileSync(file, "utf8");
        return forbiddenNeedles
          .filter((needle) => contents.includes(needle))
          .map((needle) => `${NodePath.relative(repoRoot, file)}: ${needle}`);
      },
    );

    expect(violations).toEqual([]);
  });

  it("contains no ACP workspace dependency", () => {
    const manifests = ["apps/server/package.json", "pnpm-lock.yaml"];
    const violations = manifests.filter((path) =>
      NodeFS.readFileSync(NodePath.join(repoRoot, path), "utf8").includes("effect-acp"),
    );

    expect(violations).toEqual([]);
  });
});
