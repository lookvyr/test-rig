// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const removedPaths = [
  ".github/VOUCHED.td",
  ".github/scripts/thread-transfer-report.cjs",
  ".github/scripts/thread-transfer-report.test.cjs",
  "docs/operations/release.md",
  "scripts/release-smoke.ts",
  "scripts/resolve-nightly-release.ts",
  "scripts/resolve-nightly-release.test.ts",
  "scripts/resolve-previous-release-tag.ts",
  "scripts/resolve-previous-release-tag.test.ts",
  "scripts/update-release-package-versions.ts",
  "scripts/update-release-package-versions.test.ts",
  "scripts/notify-discord-release.ts",
  "scripts/notify-discord-release.test.ts",
  "scripts/lib/update-manifest.ts",
  "apps/server/src/cli/invocation.ts",
  "apps/server/src/cli/invocation.test.ts",
] as const;

describe("release automation boundary", () => {
  it("keeps inherited workflows and publication helpers absent", () => {
    const workflowsDir = NodePath.join(repoRoot, ".github/workflows");
    const workflows = NodeFS.existsSync(workflowsDir) ? NodeFS.readdirSync(workflowsDir) : [];

    expect(workflows).toEqual([]);
    expect(removedPaths.filter((path) => NodeFS.existsSync(NodePath.join(repoRoot, path)))).toEqual(
      [],
    );
  });

  it("keeps the source-built server package private and without a publisher command", () => {
    const rootPackage = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const serverPackage = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "apps/server/package.json"), "utf8"),
    ) as { private?: boolean };
    const serverBuildCli = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/server/scripts/cli.ts"),
      "utf8",
    );
    const serviceCli = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/server/src/cli/service.ts"),
      "utf8",
    );
    const selfUpdate = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/server/src/cloud/selfUpdate.ts"),
      "utf8",
    );

    expect(rootPackage.scripts?.["release:smoke"]).toBeUndefined();
    expect(serverPackage.private).toBe(true);
    expect(serverBuildCli).not.toContain('Command.make("publish"');
    expect(serverBuildCli).not.toContain("vp pm publish");
    expect(serviceCli).not.toContain('Command.make("install"');
    expect(serviceCli).not.toContain('Command.make("update"');
    expect(selfUpdate).not.toContain("ensurePinnedRuntimeInstalled");
    expect(selfUpdate).not.toContain('command: "npm"');
  });
});
