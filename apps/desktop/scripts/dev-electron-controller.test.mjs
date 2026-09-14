import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import { afterEach, assert, describe, it, vi } from "vite-plus/test";

import { acquireLauncherOwnership, createDevAppController } from "./dev-electron-controller.mjs";

const directories = [];
afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

function lockPath() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-rig-dev-owner-"));
  directories.push(directory);
  return NodePath.join(directory, "owner.lock");
}

function fixture({ exitsOnTerm = true } = {}) {
  vi.useFakeTimers();
  const apps = [];
  const signals = [];
  const reports = [];
  const controller = createDevAppController({
    spawn: () => {
      const app = new NodeEvents.EventEmitter();
      app.pid = 10_000 + apps.length;
      apps.push(app);
      return app;
    },
    signal: (app, signal) => {
      signals.push([app.pid, signal]);
      if (signal === "SIGKILL" || exitsOnTerm) app.emit("exit", 0, signal);
    },
    report: (message) => reports.push(message),
  });
  return { controller, apps, signals, reports };
}

describe("desktop development launcher ownership", () => {
  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ]) {
    it(`releases ownership on ${signal} while startup resources are pending`, async () => {
      const directory = NodePath.dirname(lockPath());
      const scripts = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
      for (const file of ["dev-electron.mjs", "dev-electron-controller.mjs"]) {
        NodeFS.copyFileSync(NodePath.join(scripts, file), NodePath.join(directory, file));
      }
      NodeFS.writeFileSync(
        NodePath.join(directory, "electron-launcher.mjs"),
        `
        export const desktopDir = ${JSON.stringify(directory)};
        export function resolveDevProtocolClient() { throw new Error("Must not launch"); }
        export function resolveElectronLaunchCommand() { throw new Error("Must not launch"); }
      `,
      );
      NodeFS.writeFileSync(
        NodePath.join(directory, "wait-for-resources.mjs"),
        `
        export async function waitForResources() {
          await new Promise(() => {
            setInterval(() => {}, 1_000_000);
            process.send("waiting");
          });
        }
      `,
      );
      const child = NodeChildProcess.fork(NodePath.join(directory, "dev-electron.mjs"), [], {
        env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:1234" },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      try {
        assert.deepEqual(await NodeEvents.once(child, "message"), ["waiting", undefined]);
        const checkoutKey = NodeCrypto.createHash("sha256")
          .update(NodeFS.realpathSync(directory))
          .digest("hex");
        const ownershipPath = NodePath.join(
          NodeOS.tmpdir(),
          `test-rig-desktop-dev-${checkoutKey}.lock`,
        );
        assert.isTrue(NodeFS.existsSync(ownershipPath));
        const exited = NodeEvents.once(child, "exit");
        child.kill(signal);
        assert.deepEqual(await exited, [exitCode, null]);
        assert.isFalse(NodeFS.existsSync(ownershipPath));
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    });
  }

  it("rejects duplicate invocations without taking an existing owner's lock", () => {
    const path = lockPath();
    const release = acquireLauncherOwnership(path);
    assert.isFunction(release);
    assert.isNull(acquireLauncherOwnership(path));
    assert.isTrue(NodeFS.existsSync(path));
    release();
    const next = acquireLauncherOwnership(path);
    assert.isFunction(next);
    release();
    assert.isTrue(NodeFS.existsSync(path));
    next();
  });

  it("reports a stale owner without deleting a competing launcher's ownership", () => {
    const path = lockPath();
    NodeFS.writeFileSync(path, JSON.stringify({ pid: 123, token: "stale" }));
    const inspected = [];
    const nextOwner = JSON.stringify({ pid: process.pid, token: "competing-owner" });
    assert.throws(
      () =>
        acquireLauncherOwnership(path, {
          isAlive: (pid) => {
            inspected.push(pid);
            // Another contender acquired ownership after this reader inspected the stale PID.
            NodeFS.writeFileSync(path, nextOwner);
            return false;
          },
        }),
      path,
    );
    assert.deepEqual(inspected, [123]);
    assert.equal(NodeFS.readFileSync(path, "utf8"), nextOwner);
    assert.deepEqual(NodeFS.readdirSync(NodePath.dirname(path)), ["owner.lock"]);
  });

  it("leaves separate checkouts independent", () => {
    const first = acquireLauncherOwnership(lockPath());
    const second = acquireLauncherOwnership(lockPath());
    assert.isFunction(first);
    assert.isFunction(second);
    first();
    second();
  });
});

describe("desktop development app lifecycle", () => {
  it("honors the explicit development relaunch exit code without retrying a subsequent crash", async () => {
    const { controller, apps } = fixture();
    controller.start();
    apps[0].emit("exit", 75, null);
    await vi.advanceTimersByTimeAsync(120);
    assert.lengthOf(apps, 2);
    apps[1].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.lengthOf(apps, 2);
    await controller.shutdown();
  });

  it("stays stopped after a crash or normal quit until a bundle changes", async () => {
    const { controller, apps, signals } = fixture();
    controller.start();
    apps[0].emit("exit", 130, null);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.lengthOf(apps, 1);
    assert.isEmpty(signals);
    controller.bundleChanged();
    await vi.advanceTimersByTimeAsync(120);
    assert.lengthOf(apps, 2);
    apps[1].emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.lengthOf(apps, 2);
    await controller.shutdown();
  });

  it("does not automatically retry a launch error", async () => {
    const { controller, apps, reports } = fixture();
    controller.start();
    apps[0].emit("error", new Error("spawn failed"));
    await vi.advanceTimersByTimeAsync(10_000);
    assert.lengthOf(apps, 1);
    assert.include(reports[0], "waiting for a bundle change");
    await controller.shutdown();
  });

  it("debounces rebuilds and signals only its captured child", async () => {
    const { controller, apps, signals } = fixture();
    controller.start();
    controller.bundleChanged();
    controller.bundleChanged();
    await vi.advanceTimersByTimeAsync(120);
    assert.lengthOf(apps, 2);
    assert.deepEqual(signals, [[10_000, "SIGTERM"]]);
    await controller.shutdown();
    assert.deepEqual(signals, [
      [10_000, "SIGTERM"],
      [10_001, "SIGTERM"],
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.lengthOf(apps, 2);
  });

  it("bounds a hung child's shutdown without restarting while shutting down", async () => {
    const { controller, apps, signals } = fixture({ exitsOnTerm: false });
    controller.start();
    controller.bundleChanged();
    const stopped = controller.shutdown();
    await vi.advanceTimersByTimeAsync(5_000);
    assert.deepEqual(signals, [[10_000, "SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(1_000);
    await stopped;
    assert.lengthOf(apps, 1);
    assert.deepEqual(signals, [
      [10_000, "SIGTERM"],
      [10_000, "SIGKILL"],
    ]);
  });
});
