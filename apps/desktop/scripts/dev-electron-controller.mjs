import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Claim one launcher per checkout without terminating an existing owner. */
export function acquireLauncherOwnership(lockPath, { pid = process.pid, isAlive } = {}) {
  const processIsAlive =
    isAlive ??
    ((ownerPid) => {
      try {
        process.kill(ownerPid, 0);
        return true;
      } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
      }
    });
  NodeFS.mkdirSync(NodePath.dirname(lockPath), { recursive: true });
  const owner = JSON.stringify({ pid, token: NodeCrypto.randomUUID() });
  const preparedPath = `${lockPath}.${pid}.${NodeCrypto.randomUUID()}`;
  NodeFS.writeFileSync(preparedPath, owner, { flag: "wx", mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        NodeFS.linkSync(preparedPath, lockPath);
        return () => {
          try {
            if (NodeFS.readFileSync(lockPath, "utf8") === owner) NodeFS.unlinkSync(lockPath);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      try {
        const previous = NodeFS.readFileSync(lockPath, "utf8");
        const recorded = JSON.parse(previous);
        if (!Number.isInteger(recorded.pid) || recorded.pid <= 0 || processIsAlive(recorded.pid)) {
          return null;
        }
        // Unlinking after a PID check can race another launcher's acquisition.
        // Leave abandoned locks for explicit cleanup rather than removing a new owner.
        throw new Error(
          `[desktop-dev] Launcher PID ${recorded.pid} is no longer running. Remove the stale ownership file before retrying: ${lockPath}`,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  } finally {
    NodeFS.unlinkSync(preparedPath);
  }
}

/** Own only the child/group returned by spawn; crashes wait for a bundle change. */
export function createDevAppController({
  spawn,
  signal,
  report = console.error,
  restartDebounceMs = 120,
  forcedShutdownTimeoutMs = 6_000,
}) {
  let currentApp = null;
  let shuttingDown = false;
  let restartTimer = null;
  let restartQueue = Promise.resolve();
  const expectedExits = new WeakSet();

  function clearRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function start() {
    if (shuttingDown || currentApp) return;
    let app;
    try {
      app = spawn();
    } catch (error) {
      report(`[desktop-dev] Launch failed; waiting for a bundle change. ${error.message}`);
      return;
    }
    currentApp = app;
    const unexpectedExit = (detail) => {
      if (currentApp === app) currentApp = null;
      if (shuttingDown || expectedExits.has(app)) return;
      clearRestart();
      report(`[desktop-dev] ${detail}; waiting for a bundle change.`);
    };
    app.once("error", (error) => unexpectedExit(`Launch failed: ${error.message}`));
    app.once("exit", (code, exitSignal) => {
      if (code === 75 && exitSignal === null && !shuttingDown && !expectedExits.has(app)) {
        if (currentApp === app) currentApp = null;
        // DesktopLifecycle uses this exit code for an explicit development relaunch.
        bundleChanged();
        return;
      }
      unexpectedExit(`App exited (${exitSignal ?? code})`);
    });
  }

  async function stop() {
    const app = currentApp;
    if (!app) return;
    currentApp = null;
    expectedExits.add(app);
    await new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        app.removeListener("exit", finish);
        resolve();
      };
      app.once("exit", finish);
      timer = setTimeout(() => {
        signal(app, "SIGKILL");
        finish();
      }, forcedShutdownTimeoutMs);
      signal(app, "SIGTERM");
    });
  }

  function bundleChanged() {
    if (shuttingDown) return;
    clearRestart();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restartQueue = restartQueue
        .then(async () => {
          await stop();
          start();
        })
        .catch((error) => report(`[desktop-dev] Restart failed: ${error.message}`));
    }, restartDebounceMs);
  }

  async function shutdown() {
    shuttingDown = true;
    clearRestart();
    await restartQueue;
    await stop();
  }

  return { start, bundleChanged, shutdown };
}
