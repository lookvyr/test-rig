import { CheckpointId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/state/entities", () => ({ useThread: () => null }));
import { deriveWorkspaceMutationId } from "./useThreadWorkspaceMutationId";

function projected(items: Parameters<typeof deriveWorkspaceMutationId>[0][number]["item"][]) {
  return items.map((item) => ({ item }));
}

describe("workspace mutation receipts", () => {
  it("ignores unfinished tools and nonmutating transcript updates", () => {
    expect(
      deriveWorkspaceMutationId(
        projected([
          { id: TurnItemId.make("command"), type: "command_execution", status: "running" },
          { id: TurnItemId.make("file"), type: "file_change", status: "waiting" },
          { id: TurnItemId.make("message"), type: "assistant_message", status: "completed" },
        ]),
        [],
      ),
    ).toBeNull();
  });

  it("invalidates from a settled file or failed shell tool even before a turn ends", () => {
    const items = [
      { id: TurnItemId.make("file"), type: "file_change" as const, status: "completed" as const },
      {
        id: TurnItemId.make("command"),
        type: "command_execution" as const,
        status: "failed" as const,
      },
    ];
    expect(deriveWorkspaceMutationId(projected(items), [])).not.toBeNull();
    expect(deriveWorkspaceMutationId(projected(items), [])).not.toBe(
      deriveWorkspaceMutationId(projected(items.slice(0, 1)), []),
    );
  });

  it("refreshes when an earlier parallel tool settles after a later tool", () => {
    const a = { id: TurnItemId.make("A"), type: "file_change" as const };
    const b = { id: TurnItemId.make("B"), type: "command_execution" as const };
    const bCompleted = deriveWorkspaceMutationId(
      projected([
        { ...a, status: "running" },
        { ...b, status: "completed" },
      ]),
      [],
    );
    const aCompletedLater = deriveWorkspaceMutationId(
      projected([
        { ...a, status: "completed" },
        { ...b, status: "completed" },
      ]),
      [],
    );
    expect(bCompleted).not.toBeNull();
    expect(aCompletedLater).not.toBe(bCompleted);
    expect(aCompletedLater).toBe(
      deriveWorkspaceMutationId(
        projected([
          { ...a, status: "completed" },
          { ...b, status: "completed" },
          { id: TurnItemId.make("message"), type: "assistant_message", status: "completed" },
        ]),
        [],
      ),
    );
  });

  it("catches a captured checkpoint while missing/stale checkpoints cannot invalidate", () => {
    const captured = deriveWorkspaceMutationId(
      [],
      [{ id: CheckpointId.make("ready"), status: "ready" }],
    );
    expect(captured).not.toBeNull();
    expect(
      deriveWorkspaceMutationId(
        [],
        [
          { id: CheckpointId.make("ready"), status: "ready" },
          { id: CheckpointId.make("missing"), status: "missing" },
        ],
      ),
    ).toBe(captured);
    expect(
      deriveWorkspaceMutationId([], [{ id: CheckpointId.make("stale"), status: "stale" }]),
    ).toBeNull();
  });
});
