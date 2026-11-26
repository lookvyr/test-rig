import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { checkpointFileTotals, deriveThreadCheckpointSummaries } from "./threadCheckpoints.ts";

describe("checkpointFileTotals", () => {
  it("uses aggregate totals for capped records", () => {
    expect(
      checkpointFileTotals({
        files: [],
        filesTotal: { count: 250, additions: 500, deletions: 250 },
      }),
    ).toEqual({ count: 250, additions: 500, deletions: 250 });
  });
  it("derives totals for historical records", () => {
    expect(
      checkpointFileTotals({
        files: [{ path: "a", kind: "modified", additions: 2, deletions: 3 }],
      }),
    ).toEqual({ count: 1, additions: 2, deletions: 3 });
  });
});

describe("deriveThreadCheckpointSummaries", () => {
  const capturedAt = DateTime.makeUnsafe("2026-11-25T00:00:00.000Z");
  const runId = RunId.make("run:summary:1");
  const rootScopeId = CheckpointScopeId.make("scope:summary:root");
  const apiScopeId = CheckpointScopeId.make("scope:summary:api");
  const checkpoint = (
    scopeId: CheckpointScopeId,
    fields: Partial<OrchestrationV2Checkpoint>,
  ): OrchestrationV2Checkpoint => ({
    id: CheckpointId.make(`checkpoint:${scopeId}:${fields.ordinalWithinScope ?? 1}`),
    threadId: ThreadId.make("thread:summary"),
    scopeId,
    runId,
    nodeId: NodeId.make("node:summary"),
    parentCheckpointId: null,
    ordinalWithinScope: 1,
    appRunOrdinal: null,
    ref: CheckpointRef.make(`refs/t3/${scopeId}`),
    status: "ready",
    files: [],
    capturedAt,
    ...fields,
  });
  const scope = (
    id: CheckpointScopeId,
    fields: Partial<OrchestrationV2CheckpointScope>,
  ): OrchestrationV2CheckpointScope => ({
    id,
    threadId: ThreadId.make("thread:summary"),
    runId,
    nodeId: NodeId.make("node:summary"),
    parentScopeId: null,
    providerThreadId: null,
    kind: "root_run",
    ordinalWithinParent: 0,
    advancesAppRunCount: true,
    cwd: "/shop",
    createdAt: capturedAt,
    ...fields,
  });

  it("adds a turn's repository files under their folder, even when the folder has no snapshots", () => {
    const summaries = deriveThreadCheckpointSummaries({
      messages: [],
      checkpointScopes: [
        scope(rootScopeId, {}),
        scope(apiScopeId, { kind: "repository", cwd: "/shop/api", relativePath: "api" }),
      ],
      checkpoints: [
        checkpoint(rootScopeId, { appRunOrdinal: 1, status: "missing" }),
        checkpoint(apiScopeId, {
          files: [{ path: "src/x.ts", kind: "modified", additions: 2, deletions: 1 }],
        }),
      ],
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe("ready");
    expect(summaries[0]?.files.map((file) => file.path)).toEqual(["api/src/x.ts"]);
    expect(summaries[0]?.filesTotal).toEqual({ count: 1, additions: 2, deletions: 1 });
  });

  it("leaves a single-repository turn as it was", () => {
    const root = checkpoint(rootScopeId, {
      appRunOrdinal: 1,
      files: [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0 }],
    });
    const [summary] = deriveThreadCheckpointSummaries({
      messages: [],
      checkpointScopes: [scope(rootScopeId, {})],
      checkpoints: [root],
    });
    expect(summary?.files).toBe(root.files);
    expect(summary?.filesTotal).toBeUndefined();
  });
});
