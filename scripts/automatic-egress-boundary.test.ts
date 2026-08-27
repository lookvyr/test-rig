// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps", "packages", "scripts", ".github"] as const;
const sourceExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);

function productionSourceFiles(root: string): string[] {
  if (!NodeFS.existsSync(root)) {
    if (root === NodePath.join(repoRoot, ".github")) return [];
    throw new Error(`Required boundary-scan root is missing: ${NodePath.relative(repoRoot, root)}`);
  }
  const files: string[] = [];
  for (const entry of NodeFS.readdirSync(root, { withFileTypes: true })) {
    const path = NodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...productionSourceFiles(path));
      }
      continue;
    }
    if (
      sourceExtensions.has(NodePath.extname(entry.name)) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("automatic egress boundary", () => {
  it("contains no automatic egress enablement paths", () => {
    const forbiddenNeedles = [
      ["posthog", "com"].join("."),
      ["T3CODE", "POSTHOG"].join("_"),
      ["T3CODE", "OTLP", ""].join("_"),
      ["EXPO", "PUBLIC", "OTLP", ""].join("_"),
      ["T3CODE", "MOBILE", "OTLP", ""].join("_"),
      ["T3CODE", "RELAY", "CLIENT", "OTLP", ""].join("_"),
      ["VITE", "RELAY", "OTLP", ""].join("_"),
      ["__T3CODE", "BUILD", "RELAY", "CLIENT", "OTLP", ""].join("_"),
      ["electron", "updater"].join("-"),
      ["auto", "Updater"].join(""),
      ["app", "update.yml"].join("-"),
      [".", "blockmap"].join(""),
      ["google.com", "s2", "favicons"].join("/"),
      ["model", "prices", "and", "context", "window.json"].join("_"),
      ["registry", "npmjs", "org"].join("."),
    ];
    const violations = sourceRoots.flatMap((sourceRoot) =>
      productionSourceFiles(NodePath.join(repoRoot, sourceRoot)).flatMap((file) => {
        const contents = NodeFS.readFileSync(file, "utf8");
        return forbiddenNeedles
          .filter((needle) => contents.includes(needle))
          .map((needle) => `${NodePath.relative(repoRoot, file)}: ${needle}`);
      }),
    );

    expect(violations).toEqual([]);
  });

  it("contains no removed Tailscale integration paths", () => {
    const forbiddenNeedles = [
      "@t3tools/tailscale",
      "tailscaleServeEnabled",
      "tailscaleServePort",
      "SET_TAILSCALE_SERVE_ENABLED_CHANNEL",
      "--tailscale-serve",
      "--share",
      "dev:share",
      ".ts.net",
    ];
    const files = [
      ...sourceRoots.flatMap((sourceRoot) =>
        productionSourceFiles(NodePath.join(repoRoot, sourceRoot)),
      ),
      NodePath.join(repoRoot, "package.json"),
      NodePath.join(repoRoot, "pnpm-workspace.yaml"),
    ];
    const violations = files.flatMap((file) => {
      const contents = NodeFS.readFileSync(file, "utf8");
      return forbiddenNeedles
        .filter((needle) => contents.includes(needle))
        .map((needle) => `${NodePath.relative(repoRoot, file)}: ${needle}`);
    });

    expect(violations).toEqual([]);
  });
});
