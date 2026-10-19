import { EnvironmentId, RunId, type OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { createEnvironmentThreadShellAtoms } from "./threadShell.ts";
import { v2Now, v2ThreadShell, v2ShellSnapshot } from "./orchestrationV2TestFixtures.ts";

describe("quiet thread shell subscriptions", () => {
  it("suppresses 100 streaming notifications while preserving metadata, first content and completion", () => {
    const environmentId = EnvironmentId.make("environment");
    const runId = RunId.make("run");
    const running = {
      ...v2ThreadShell,
      activeRunId: runId,
      latestRunId: runId,
      status: "running" as const,
    };
    const snapshot = Atom.make<OrchestrationV2ShellSnapshot | null>({
      ...v2ShellSnapshot,
      threads: [running],
    });
    const atoms = createEnvironmentThreadShellAtoms({
      catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
      snapshotAtom: () => snapshot,
    });
    const registry = AtomRegistry.make();
    const ref = { environmentId, threadId: running.id };
    let rawChanges = 0;
    let quietChanges = 0;
    const unsubRaw = registry.subscribe(atoms.threadShellAtom(ref), () => rawChanges++);
    const unsubQuiet = registry.subscribe(atoms.quietThreadShellAtom(ref), () => quietChanges++);
    const set = (thread: typeof running) => {
      registry.set(snapshot, { ...v2ShellSnapshot, threads: [thread] });
      registry.get(atoms.threadShellAtom(ref));
      registry.get(atoms.quietThreadShellAtom(ref));
    };
    try {
      set({ ...running, itemCount: 1, visibleItemCount: 1 });
      expect(quietChanges).toBe(1);
      const first = registry.get(atoms.quietThreadShellAtom(ref));
      for (let tick = 1; tick <= 100; tick++) {
        set({
          ...running,
          itemCount: tick + 1,
          visibleItemCount: tick + 1,
          updatedAt: DateTime.add(v2Now, { seconds: tick }),
        });
      }
      expect(rawChanges).toBe(101);
      expect(quietChanges).toBe(1);
      expect(registry.get(atoms.quietThreadShellAtom(ref))).toBe(first);
      set({ ...running, branch: "feature", itemCount: 101, visibleItemCount: 101 });
      expect(registry.get(atoms.quietThreadShellAtom(ref))?.branch).toBe("feature");
      expect(quietChanges).toBe(2);
      registry.set(snapshot, {
        ...v2ShellSnapshot,
        threads: [
          {
            ...running,
            status: "completed",
            activeRunId: null,
            itemCount: 101,
            visibleItemCount: 101,
          },
        ],
      });
      registry.get(atoms.quietThreadShellAtom(ref));
      expect(quietChanges).toBe(3);
      registry.set(snapshot, null);
      expect(registry.get(atoms.quietThreadShellAtom(ref))).toBeNull();
    } finally {
      unsubRaw();
      unsubQuiet();
      registry.dispose();
    }
  });
});
