# Native orchestration cutover

> Historical staged implementation. The [nightly integration](./orchestration-v2-nightly-sync.md)
> supersedes the runtime, adapter, dependency, and verification descriptions below.

LOO-21 activates the V2 runtime and client on top of the storage and provider
slices. The upstream reference is `de343914273eceb852a1d1d739cd1d38df7796ee`.
Test Rig keeps its existing composer, sidebar, timeline, diff viewer, permission
modes, provider registry, local-first connection model, and workspace ownership.

## Startup and persistence

The server selects `statev2.sqlite`, imports legacy shells, reconciles interrupted
runtime work, and starts the durable effect worker before accepting orchestration
commands. Legacy transcripts hydrate when needed and through background import.
The first V2 database is a consistent snapshot of `state.sqlite`; subsequent writes
remain in V2. The original database is preserved, but does not receive later V2
work. Switching back to the old engine therefore cannot retain that later work.

The old orchestration reactor and provider event pump are not started alongside
the native runtime. Restart recovery records interrupted/background work without
automatically prompting providers to continue it. Temporary side chats expire at
startup; their parent conversations remain intact.

## Transport and client

Orchestration HTTP and WebSocket connections require protocol version 2. The
shared client stores native shells and thread projections, and presents them to
the retained web components through derived selectors. Run, request, and inherited
source identities remain native; there is no reconstructed V1 thread model.

Initial thread reads and reconnect fallbacks use bounded history. Recent history
retains ten complete user turns; earlier pages retain twenty. Item and byte budgets
apply to histories without user-turn boundaries, and required live control state
is retained. A single large complete turn may exceed the normal byte budget.
Older pages merge by source identity and reject stale responses after live events
or rollback. Find reads paged messages and loads a bounded window around the
selected source item. Raw tool output is omitted from wire projections and tool
details; typed input, status, and exit code remain visible.

## Retained lifecycle behavior

Scratch threads bind to the same dedicated folder during draft preparation,
creation, and launch. Setup-script startup failures add a visible warning and do
not prevent the first provider turn. Worktree provisioning failure fails the held
run. Archive cancels queued/preparing/not-yet-started runs; late preparation cannot
release them or restore a removed worktree path.

Codex and Claude side chats capture the parent's native context immediately and
start with an empty visible transcript. They are temporary and support discard,
not conversion into a durable fork. Explicit linked/unlinked PR choices, worktree
cleanup guards, pending approvals/questions, subagent presentation, settlement,
and snooze behavior use the native projection and effect boundaries.

## Verification scope

Focused checks cover native RPC/HTTP, replay and reconnect, bounded history and
Find, storage and migration, provider events, side ownership, Scratch/setup/archive
races, cleanup, and retained client presentation. Test clocks, deferred completion,
and durable receipts replace time-based polling in concurrency tests.

The isolated application checks exercised successful Codex and Claude turns,
tools and file edits, the existing diff viewer, Stop, Find, Claude side-chat context,
Scratch workspace creation, and a supervised approval. The native OpenCode adapter
has focused test coverage; this cutover's live app check could not use the locally
configured OpenCode instance because its version check failed. The earlier provider
slice's OpenCode verification remains recorded separately. Desktop shell code is
unchanged; its package typecheck covers the shared contract integration.

LOO-22 remains the broader product verification pass. This cutover does not import
upstream scheduling, managed hosting/relay behavior, or automatic restart prompts.
