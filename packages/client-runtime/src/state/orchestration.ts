import { ORCHESTRATION_WS_METHODS, ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { applyCommandOutputFrame, EMPTY_COMMAND_OUTPUT } from "./commandOutput.ts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // One expanded command row's output. Mounted only while the row is open,
    // and released as soon as it closes, so hidden rows receive nothing.
    commandOutput: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:orchestration-v2:command-output",
      tag: ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
      idleTtlMs: 0,
      // `scan` emits its seed first; skipping it keeps the row "loading" until the first frame.
      transform: (frames) =>
        frames.pipe(
          Stream.scan(EMPTY_COMMAND_OUTPUT, applyCommandOutputFrame),
          Stream.filter((view) => view !== EMPTY_COMMAND_OUTPUT),
        ),
    }),
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    workflowScript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:workflow-script",
      tag: ORCHESTRATION_WS_METHODS.getWorkflowScript,
      // Scripts are immutable per run: cache generously.
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
    stopWorkflow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:orchestration:stop-workflow",
      tag: ORCHESTRATION_V2_WS_METHODS.stopWorkflow,
    }),
    // One fetch while running, then a fresh cache key when the item finishes.
    turnItem: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-item",
      tag: ORCHESTRATION_V2_WS_METHODS.getTurnItem,
      staleTimeMs: 60_000,
      idleTtlMs: 60_000,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    threadSearchContext: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search-context",
      tag: ORCHESTRATION_WS_METHODS.getThreadSearchContext,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    threadSearchMessages: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search-messages",
      tag: ORCHESTRATION_WS_METHODS.searchThreadMessages,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    threadSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search",
      tag: ORCHESTRATION_WS_METHODS.searchThreads,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
  };
}
