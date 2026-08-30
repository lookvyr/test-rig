# Provider architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. T3 Code supports several, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with three entries:

| Driver kind   | Driver source                           |
| ------------- | --------------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]       |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude]     |
| `opencode`    | [`Drivers/OpenCodeDriver.ts`][opencode] |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Adapter implementations live beside them in
`apps/server/src/provider/Layers/` (`CodexAdapter.ts`, `ClaudeAdapter.ts`, and so on) and conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

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

## How provider work is requested

Clients never call a provider directly. They dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond`, `thread.checkpoint.revert`, and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

The engine persists an event for the command, and a server-side reactor performs the provider call.
Provider output comes back as internal commands such as `thread.message.assistant.delta` and
`thread.session.set`, which clients observe through `orchestration.subscribeThread`. See
[overview.md](./overview.md) for the command/event loop.

## Side chats

`thread.side.open` creates one hidden child with `sideOfThreadId` pointing to its parent.
It inherits the parent's current model, permission mode, and checkout. The provider command
reactor opens a separate runtime without starting a turn or continuing a goal. Codex uses native
`thread/fork`; Claude uses the Agent SDK's `forkSession`, then resumes the persisted child.
Native history supplies context; the child starts with an empty visible timeline. OpenCode forks
are explicitly unsupported.

Claude's session helpers read `CLAUDE_CONFIG_DIR` from the process environment, so the fork runs
in a short-lived subprocess with the selected provider instance's environment. The adapter tracks
the current top-level native message UUID and forks through that exact boundary. Missing or
incomplete boundaries fail without substituting older history. Compaction invalidates the boundary
until a subsequent top-level message establishes it again. The latest submitted prompt UUID must
also appear at or before the fork boundary, so an older in-flight response cannot hide a queued
follow-up. Claude saves queued prompts as attachments with a separate UUID. The SDK's transcript
import API supplies temporary in-memory metadata to resolve that UUID and verify ancestry within
the retained prefix for both ordinary and queued requests. It does not retain prompt
or tool contents. If compaction removes the request from that ancestry, another parent exchange
is needed before forking. Stopped sessions and idle resumed sessions select the saved
tail: persisted cursors can predate the last response and are not trusted as current boundaries.
There is no transcript polling or replay of
normalized messages. The child is persisted before opening completes, so Keep also works before
the first side-chat message.

Side chats use the ordinary thread commands, subscriptions, approvals, and checkpoints. Their
native resume cursor is strict: a missing or rejected cursor must never fall back to a fresh
conversation, including after Keep. Claude confirms native resumption before reporting the child
ready. Per-turn side-chat instructions stop applying after Keep.
The checkout is shared, so file changes and diffs are not isolated by conversation. Automatic
branch naming skips shared worktrees, and checkpoint restore is blocked for a temporary side
or its parent while the side exists.

Closing the panel preserves the child. `thread.side.keep` clears the relationship on the same
record; conditional `thread.delete` discards only a still-temporary child. Parent deletion
cascades to temporary children. The deletion reactor expires remaining temporary children
once at backend startup, before other reactors and client commands start. Hidden children
remain in backing state for ownership checks but are excluded from navigation and search.

## Server-side workers

Provider work flows through three queue-backed workers. All three are built with
`makeDrainableWorker` from [`DrainableWorker.ts`][worker] and expose `drain` for deterministic test
synchronization.

1. [`ProviderRuntimeIngestion`][ingest] consumes provider runtime streams and emits orchestration
   commands.
2. [`ProviderCommandReactor`][cmd] reacts to orchestration intent events and dispatches provider
   calls.
3. [`CheckpointReactor`][checkpoint] captures workspace checkpoints on turn start and completion, and
   performs reverts.

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
[opencode]: ../../apps/server/src/provider/Drivers/OpenCodeDriver.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
