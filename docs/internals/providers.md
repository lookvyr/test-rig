# Provider architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. Test Rig supports Codex and Claude, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with two entries:

| Driver kind   | Driver source                       |
| ------------- | ----------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]   |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude] |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Codex and Claude adapter implementations live in
`apps/server/src/provider/Layers/`. They conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

The current app uses V2 orchestration, wired through
[`orchestration-v2/Rpc.ts`](../../apps/server/src/orchestration-v2/Rpc.ts).
The registry and worker descriptions below include retained V1 code; they do not
make legacy commands available in the current app. [V2 provider adapters](./orchestration-v2-providers.md)
records the earlier adapter implementation.

## Registry and routing

Two registries separate configuration from live processes:

- [`ProviderInstanceRegistry`][instances] keys configured instances by `ProviderInstanceId`. Creating
  one looks up the driver by `driverKind`, decodes `entry.config` with that driver's schema, opens a
  child scope, and calls `driver.create`.
- [`ProviderAdapterRegistry`][registry] resolves an instance ID to its live adapter via
  `getByInstance`.

[`ProviderService`][service] sits on top. It combines the adapter registry with the provider session
directory to route session and turn operations for a thread, so callers name a thread, not an agent.

Adding a driver means writing the driver plus adapter and adding it to `BUILT_IN_DRIVERS`. No
orchestration, contract, or client change is required for the common case.

## Legacy V1 provider requests

In the retained V1 implementation, clients dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond` and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

The legacy contract also contains `thread.checkpoint.revert`. Test Rig does not
support conversation rewind or checkpoint-based file restoration: the current
[V2 orchestrator](../../apps/server/src/orchestration-v2/Orchestrator.ts) rejects
`checkpoint.rollback`, and
[`CheckpointRollbackService.ts`](../../apps/server/src/orchestration-v2/CheckpointRollbackService.ts)
rejects historical rollback effects. Checkpoint capture, diffs, and forks from an
earlier response remain supported.

The engine persists an event for the command, and a server-side reactor performs the provider call.
Provider output comes back as internal commands such as `thread.message.assistant.delta` and
`thread.session.set`, which clients observe through `orchestration.subscribeThread`. See
[overview.md](./overview.md) for the command/event loop.

## Side chats

The native (V2) runtime implements side chats as forks with `lineage.sideChat`; see
[side-chat-tools.md](./side-chat-tools.md). Each provider sees an ordinary fork: a native fork
(Codex `thread/fork`, Claude `forkSession`) when the source allows it, otherwise a portable summary,
plus an inline context note on the first turn. Adapters add no side-chat instructions. The older
`thread.side.open` path in the legacy engine is not started alongside the native runtime.

## Native goals

Native `/goal` state belongs to the provider and is mirrored on the provider thread
(`OrchestrationV2ProviderThread.goal`); the thread shell exposes the active
provider thread's goal. Codex starts the next goal turn on its own milliseconds
after the last one completes, so the Codex V2 adapter keeps the run open and adds
that turn to it. One run can therefore own several native turns; use
`latestProviderTurnForAttempt` rather than the attempt's first turn. `/goal`
commands that start no Codex turn settle on a provider turn without a native ref.
Claude's SDK mode emits no goal events; its adapter reads goal state from the
synthetic command output and Stop hook feedback in the transcript. A Claude goal is not marked complete while the live process
still runs background work, including background subagents. Ported from upstream
T3 Code #15592 and #16598. A `/goal` command never carries inline context: earlier
handoffs wait for the next ordinary turn unless the provider injects them out of
band, because the adapter parses the command from the message text.

## Legacy V1 server-side workers

The retained V1 implementation has three queue-backed workers. All three are built with
`makeDrainableWorker` from [`DrainableWorker.ts`][worker] and expose `drain` for deterministic test
synchronization.

1. [`ProviderRuntimeIngestion`][ingest] consumes provider runtime streams and emits orchestration
   commands.
2. [`ProviderCommandReactor`][cmd] reacts to orchestration intent events and dispatches provider
   calls.
3. [`CheckpointReactor`][checkpoint] captures workspace checkpoints on turn start and completion, and
   contains legacy revert handling. The current V2 runtime rejects rollback as described above.

### Buffered assistant delivery

A thread in `buffered` assistant delivery mode accumulates assistant text instead of streaming each
delta. The buffer is not held until turn completion. In [`ProviderRuntimeIngestion`][ingest],
`MAX_BUFFERED_ASSISTANT_CHARS` is 24,000: the append that would exceed it invalidates the buffer and
spills the whole accumulated text as one delta. The buffer also flushes at interaction boundaries,
when a request opens (approval) or user input is requested, via
`flushBufferedAssistantMessagesForTurn`.

[drivers]: ../../apps/server/src/provider/builtInDrivers.ts
[codex]: ../../apps/server/src/provider/Drivers/CodexDriver.ts
[claude]: ../../apps/server/src/provider/Drivers/ClaudeDriver.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
