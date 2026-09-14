import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import {
  desktopDir,
  resolveDevProtocolClient,
  resolveElectronLaunchCommand,
} from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";
import { acquireLauncherOwnership, createDevAppController } from "./dev-electron-controller.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = [
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "../server/dist/bin.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.cjs", "preload.cjs"]) },
  { directory: "../server/dist", files: new Set(["bin.mjs"]) },
];
const remoteDebuggingPort = process.env.T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
const hostPlatform = NodeOS.platform();

const checkoutKey = NodeCrypto.createHash("sha256")
  .update(NodeFS.realpathSync(desktopDir))
  .digest("hex");
const releaseOwnership = acquireLauncherOwnership(
  NodePath.join(NodeOS.tmpdir(), `test-rig-desktop-dev-${checkoutKey}.lock`),
);
if (!releaseOwnership) {
  console.info("[desktop-dev] This checkout already has a launcher; leaving it running.");
  process.exit(0);
}
process.once("exit", releaseOwnership);
// Signals during resource startup must also reach process.exit and release the claim.
let handleShutdown = (exitCode) => process.exit(exitCode);
process.once("SIGINT", () => {
  void handleShutdown(130);
});
process.once("SIGTERM", () => {
  void handleShutdown(143);
});
process.once("SIGHUP", () => {
  void handleShutdown(129);
});

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
const devProtocolClient = resolveDevProtocolClient();
if (devProtocolClient) {
  childEnv.T3CODE_DESKTOP_APP_USER_MODEL_ID = devProtocolClient.appBundleId;
  childEnv.T3CODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED = "1";
}

const watchers = [];
const controller = createDevAppController({
  spawn: () => {
    const electronArgs = remoteDebuggingPort
      ? [`--remote-debugging-port=${remoteDebuggingPort}`]
      : [];
    const launchArgs = devProtocolClient
      ? electronArgs
      : [...electronArgs, `--test-rig-dev-root=${desktopDir}`, "dist-electron/main.cjs"];
    const electronCommand = resolveElectronLaunchCommand(launchArgs);
    return NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
      cwd: desktopDir,
      env: childEnv,
      stdio: "inherit",
      detached: hostPlatform !== "win32",
    });
  },
  signal: (app, signal) => {
    if (hostPlatform === "win32") {
      app.kill(signal);
      return;
    }
    if (!app.pid) return;
    try {
      process.kill(-app.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  },
});

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = NodeFS.watch(
      NodePath.join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        controller.bundleChanged();
      },
    );

    watchers.push(watcher);
  }
}

let shuttingDown = false;
async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const watcher of watchers) watcher.close();
  await controller.shutdown();
  process.exit(exitCode);
}

startWatchers();
controller.start();
handleShutdown = shutdown;
