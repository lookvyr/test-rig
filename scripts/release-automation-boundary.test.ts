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
  "apps/server/src/cli/service.ts",
  "apps/server/src/cli/service.test.ts",
  "apps/server/src/cli/servicePreflight.ts",
  "apps/server/src/cloud/bootService.ts",
  "apps/server/src/cloud/bootService.test.ts",
  "apps/server/src/cloud/pinnedRuntime.ts",
  "apps/server/src/cloud/pinnedRuntime.test.ts",
  "apps/server/src/cloud/selfUpdate.ts",
  "apps/server/src/cloud/selfUpdate.test.ts",
  "apps/server/src/cloud/serviceLauncherClient.ts",
  "apps/server/src/cloud/serviceLauncherClient.test.ts",
  "apps/server/src/cloud/servicePreflight.ts",
  "apps/server/src/cloud/servicePreflight.test.ts",
  "apps/server/src/cloud/serviceProtocol.ts",
  "apps/server/src/service-launcher.ts",
  "apps/server/src/serviceLauncher.ts",
  "apps/server/src/serviceLauncher.test.ts",
  "apps/web/src/components/ServerUpdateAction.tsx",
  "apps/web/src/components/ServerUpdateAction.test.tsx",
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

  it("keeps the source-built server package private and source-only", () => {
    const rootPackage = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const serverPackage = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "apps/server/package.json"), "utf8"),
    ) as { private?: boolean; scripts?: Record<string, string> };
    const serverBuildCli = NodeFS.readFileSync(
      NodePath.join(repoRoot, "apps/server/scripts/cli.ts"),
      "utf8",
    );

    expect(rootPackage.scripts?.["release:smoke"]).toBeUndefined();
    expect(serverPackage.private).toBe(true);
    expect(serverBuildCli).not.toContain('Command.make("publish"');
    expect(serverBuildCli).not.toContain("vp pm publish");
    expect(serverPackage.scripts?.["build:bundle"]).toBe("vp pack");
  });

  it("keeps the inherited service and self-update wire absent", () => {
    const boundarySources = [
      "apps/server/src/bin.ts",
      "apps/server/src/ws.ts",
      "packages/contracts/src/environment.ts",
      "packages/contracts/src/rpc.ts",
      "packages/contracts/src/server.ts",
      "packages/client-runtime/src/state/server.ts",
    ]
      .map((path) => NodeFS.readFileSync(NodePath.join(repoRoot, path), "utf8"))
      .join("\n");

    expect(boundarySources).not.toContain("serverUpdateServer");
    expect(boundarySources).not.toContain("ServerSelfUpdate");
    expect(boundarySources).not.toContain("ServiceLauncher");
  });
});
