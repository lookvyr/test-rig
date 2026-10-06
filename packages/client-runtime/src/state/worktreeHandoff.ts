import type { OrchestrationV2ThreadProjection, OrchestrationV2TurnItem } from "@t3tools/contracts";

import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";
import { readT3ToolInput } from "../t3ToolSummary.ts";

type Rows = OrchestrationV2ThreadProjection["visibleTurnItems"];

/** Display app-owned handoff receipts even when detaching cancelled the MCP response. */
export function createWorktreeHandoffProjector() {
  const cache = new WeakMap<
    Rows[number],
    { receipt: OrchestrationV2TurnItem; row: Rows[number] }
  >();
  return (rows: Rows, retained: ReadonlyArray<OrchestrationV2TurnItem> = []): Rows => {
    const items = new Map(
      [...retained, ...rows.map((row) => row.item)].map((item) => [item.id, item]),
    );
    const receipts = [...items.values()].flatMap((item) =>
      item.type === "system_notice" && item.worktreeHandoff !== undefined ? [item] : [],
    );
    if (receipts.length === 0) return rows;
    const byTool = new Map(
      receipts.flatMap((receipt) => {
        // The MCP request can arrive before the provider publishes its tool item.
        // Resolve against current rows so late events work without retries or polling.
        const candidates = [...items.values()].filter(
          (item) =>
            item.type === "dynamic_tool" &&
            item.runId === receipt.runId &&
            item.providerTurnId === receipt.providerTurnId &&
            resolveT3McpToolDefinition(item.toolName)?.summaryAction === "worktree-handoff" &&
            readT3ToolInput(item.input)?.branch === receipt.worktreeHandoff!.branch,
        );
        return candidates.length === 1 ? [[candidates[0]!.id, receipt] as const] : [];
      }),
    );
    const transitionedRuns = new Set(receipts.map((item) => item.runId));
    const manualStops = new Set(
      [...items.values()].flatMap((item) =>
        item.type === "run_interrupt_request" ? [item.runId] : [],
      ),
    );
    return rows.flatMap((row) => {
      const { item } = row;
      if (
        item.type === "run_interrupt_result" &&
        transitionedRuns.has(item.runId) &&
        !manualStops.has(item.runId)
      )
        return [];
      const receipt = byTool.get(item.id);
      if (item.type !== "dynamic_tool" || receipt === undefined) return [row];
      const cached = cache.get(row);
      if (cached?.receipt === receipt) return [cached.row];
      const displayed: Rows[number] = {
        ...row,
        item: {
          ...item,
          status: "completed" as const,
          output: JSON.stringify(receipt.worktreeHandoff),
        },
      };
      cache.set(row, { receipt, row: displayed });
      return [displayed];
    });
  };
}
