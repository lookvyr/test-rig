import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  resolveDiffPanelTurnId,
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
} from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      fileSelectionByThreadKey: {},
      diffRenderMode: "stacked",
    }),
  );

  it("keeps the selected render mode in panel and persisted state", async () => {
    useDiffPanelStore.getState().setDiffRenderMode("split");

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({ diffRenderMode: "split" });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({ diffRenderMode: "split" });

    useDiffPanelStore.setState({ diffRenderMode: "stacked" });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("persists file selection across panel remounts and reloads", async () => {
    const selection = { scope: "working-tree:auto", path: "src/last.ts", turnRevealRequestId: 0 };
    useDiffPanelStore.getState().selectFile(THREAD_REF, selection);
    useDiffPanelStore.getState().selectFile(THREAD_REF, selection);
    const expected = { ...selection, revealRequestId: 2 };
    expect(
      useDiffPanelStore.getState().fileSelectionByThreadKey[scopedThreadKey(THREAD_REF)],
    ).toEqual(expected);
    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({
      fileSelectionByThreadKey: { [scopedThreadKey(THREAD_REF)]: expected },
    });
    useDiffPanelStore.setState({ fileSelectionByThreadKey: {} });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();
    expect(
      useDiffPanelStore.getState().fileSelectionByThreadKey[scopedThreadKey(THREAD_REF)],
    ).toEqual(expected);
  });

  it("keeps navigation independent by thread and clears it when removing a thread", () => {
    const otherRef = scopeThreadRef(EnvironmentId.make("environment-2"), THREAD_REF.threadId);
    useDiffPanelStore
      .getState()
      .selectFile(THREAD_REF, { scope: "branch:auto", path: "a.ts", turnRevealRequestId: 0 });
    useDiffPanelStore
      .getState()
      .selectFile(otherRef, { scope: "turn:2", path: "b.ts", turnRevealRequestId: 4 });
    useDiffPanelStore
      .getState()
      .selectFile(THREAD_REF, { scope: "branch:auto", path: "c.ts", turnRevealRequestId: 0 });
    expect(
      useDiffPanelStore.getState().fileSelectionByThreadKey[scopedThreadKey(otherRef)],
    ).toEqual({ scope: "turn:2", path: "b.ts", turnRevealRequestId: 4, revealRequestId: 1 });
    useDiffPanelStore.getState().removeThread(THREAD_REF);
    expect(Object.keys(useDiffPanelStore.getState().fileSelectionByThreadKey)).toEqual([
      scopedThreadKey(otherRef),
    ]);
  });

  it("advances external turn reveals beyond saved navigation after a scope change", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "a.ts");
    useDiffPanelStore
      .getState()
      .selectFile(THREAD_REF, { scope: "turn:1", path: "b.ts", turnRevealRequestId: 1 });
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "staged");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "c.ts");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "c.ts", revealRequestId: 2 });
  });

  it("hydrates existing v2 state that predates persisted file navigation", async () => {
    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    await storage?.setItem(name, {
      version: 2,
      state: { byThreadKey: {}, branchBaseRefByThreadKey: {}, diffRenderMode: "split" } as never,
    });
    await useDiffPanelStore.persist.rehydrate();
    expect(useDiffPanelStore.getState().fileSelectionByThreadKey).toEqual({});
    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "working-tree" });
  });

  it("migrates the old combined unstaged scope without changing pinned turn or branch choices", async () => {
    const migrate = useDiffPanelStore.persist.getOptions().migrate;
    expect(
      await migrate?.(
        {
          byThreadKey: {
            combined: { kind: "unstaged" },
            branch: { kind: "branch", baseRef: "origin/main" },
            turn: { kind: "turn", turnId: "turn-1", filePath: null, revealRequestId: 1 },
          },
          diffRenderMode: "split",
        },
        1,
      ),
    ).toEqual({
      byThreadKey: {
        combined: { kind: "working-tree" },
        branch: { kind: "branch", baseRef: "origin/main" },
        turn: { kind: "turn", turnId: "turn-1", filePath: null, revealRequestId: 1 },
      },
      diffRenderMode: "split",
    });
  });

  it("keeps Latest turn live while an explicit turn stays pinned", () => {
    const first = TurnId.make("turn-1");
    const second = TurnId.make("turn-2");
    useDiffPanelStore.getState().selectLatestTurn(THREAD_REF);
    const live = selectThreadDiffPanelSelection(
      useDiffPanelStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(live).toEqual({ kind: "latest-turn" });
    expect(resolveDiffPanelTurnId(live, first)).toBe(first);
    expect(resolveDiffPanelTurnId(live, second)).toBe(second);
    expect(resolveDiffPanelTurnId(live, null)).toBeNull();

    useDiffPanelStore.getState().selectTurn(THREAD_REF, first);
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [second, first]);
    expect(
      resolveDiffPanelTurnId(
        selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
        second,
      ),
    ).toBe(first);
  });

  it.each(["working-tree", "unstaged", "staged"] as const)(
    "retains the %s scope distinctly",
    (scope) => {
      useDiffPanelStore.getState().selectGitScope(THREAD_REF, scope);
      expect(
        selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
      ).toEqual({ kind: scope });
    },
  );

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("opens the latest commit by default and supports a pinned commit", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "commit");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitRef: null });
    useDiffPanelStore.getState().selectCommit(THREAD_REF, " abc123 ");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "commit");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitRef: "abc123" });
    useDiffPanelStore.getState().selectCommit(THREAD_REF, "  ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitRef: null });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });
});
