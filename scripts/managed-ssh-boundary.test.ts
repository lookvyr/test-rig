// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const read = (path: string) => NodeFS.readFileSync(NodePath.join(repoRoot, path), "utf8");

describe("managed SSH boundary", () => {
  it("removes the remote launcher, discovery, and password prompts", () => {
    for (const path of [
      "packages/ssh",
      "apps/desktop/src/ssh",
      "apps/desktop/src/ipc/methods/sshEnvironment.ts",
      "apps/web/src/state/desktopSshHosts.ts",
      "apps/web/src/components/desktop/SshPasswordPromptDialog.tsx",
    ]) {
      expect(NodeFS.existsSync(NodePath.join(repoRoot, path)), path).toBe(false);
    }
  });

  it("keeps managed SSH out of the desktop bridge and active connection runtime", () => {
    for (const path of [
      "apps/desktop/package.json",
      "apps/desktop/src/main.ts",
      "apps/desktop/src/preload.ts",
      "apps/desktop/src/ipc/channels.ts",
      "apps/desktop/src/ipc/DesktopIpcHandlers.ts",
      "packages/contracts/src/ipc.ts",
      "packages/client-runtime/src/connection/model.ts",
      "packages/client-runtime/src/connection/catalog.ts",
      "packages/client-runtime/src/connection/resolver.ts",
      "packages/client-runtime/src/platform/capabilities.ts",
      "apps/web/src/connection/platform.ts",
      "apps/web/src/components/settings/ConnectionsSettings.tsx",
    ]) {
      expect(read(path), path).not.toMatch(
        /@t3tools\/ssh|SshEnvironment|SshConnection|SshPassword|SSH_.*CHANNEL/u,
      );
    }
  });
});
