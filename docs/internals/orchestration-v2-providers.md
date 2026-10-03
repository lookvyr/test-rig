# V2 provider adapters

LOO-20 adds the provider boundary for the V2 foundation. The active app still uses
the existing orchestration engine. LOO-21/22 own the V2 worker and client cutover.

Each approved driver exposes an `orchestrationAdapter`. The V2 registry resolves
only enabled instances from the existing provider-instance registry; it does not
add another settings subscription or process manager. Codex and Claude reuse
their native engines through `NativeAdapterV2`. Each driver creates separate
native session maps for the current engine and V2 so their event consumers cannot
claim each other's sessions. OpenCode uses the official `@opencode/client` Promise
client at version 2.0.18 for both paths, discovery, and auxiliary generation.

## Runtime and identity

App thread, provider session, provider thread, turn, attempt, item, and request
identities stay distinct. Native cursors are persisted in provider-thread metadata.
Live requests retain their exact native RPC identity, including cancellation,
secret questions, nonblocking questions, and automatic-resolution timing.
Callbacks do not survive a process restart. Missing or incompatible native history
fails explicitly rather than opening an empty replacement conversation.

Native child output retains agent and parent-tool attribution. Child task terminals
update the child roster; only the matching root terminal completes a run. Tasks
that finish after another user turn retain their original run ownership. Command
output, file diffs, todos, and proposed plans map to the corresponding V2 items.

Unsolicited native turns are buffered and offered to `ProviderContinuationRequests`.
The V2 worker must consume that queue and allocate an agent-created message with
`creationSource: provider` before calling `startTurn`. That call adopts the buffered
turn without submitting a synthetic prompt. A per-thread semaphore serializes
live translation with buffered replay. Pending continuations prevent a competing
user turn from claiming that output. The queue consumer belongs to the later worker
slice and is deliberately not activated by the current engine.

## Forks and capabilities

V2 side forks from a busy Codex or Claude parent use its latest completed boundary.
Codex passes `lastTurnId` to native `thread/fork`; Claude keeps a completed transcript
boundary separate from its active request. OpenCode records the pre-prompt native
history boundary and forks before the first message after it. A missing safe
boundary fails explicitly, and the parent is not interrupted. Existing current-engine
Codex/Claude side-chat behavior remains on its original path.

Capability flags in `Adapters/nativeCapabilities.ts` are the contract for later
client and tool dispatch. OpenCode advertises no MCP callbacks, structured todo or
plan artifacts, or native-subagent forks. Its native plan agent is still selectable.
Forms support unconditional string and multi-select questions; unsupported forms
are cancelled with an explicit runtime error. Arbitrary historical-turn and native
subagent forks are gated for all three adapters in this slice.

Normalized snapshot reads are also gated. The app's durable projection owns the
visible transcript. Native history is used internally for forks and conversation
rollback; returning a raw provider payload does not constitute a normalized V2
snapshot. Filesystem checkpoints remain app-owned.

## OpenCode 2 ownership

Local executables must report major version 2 before a server is spawned. OpenCode 1
has no executable fallback, and old cursors are rejected. This code does not migrate
provider-owned databases. Existing app records remain readable under the legacy
basic-import policy.

Local servers have a random password and scoped process ownership. Discovery,
generation, and sessions share a per-instance connection while leases remain;
the last release closes a server owned by Test Rig. Explicit external servers use
the configured authentication and are never terminated by Test Rig. Discovery
subscribes before reading the native catalog and waits for bounded native readiness
events on a cold server, without a polling loop. Auxiliary generation owns a
temporary session, rejects tools, and interrupts/removes that session on completion
or failure. Provider errors may still fail a generation request.

## Verification, 2026-10-03

240 provider tests and 7 contract tests passed. Focused fixtures cover native request metadata/cancellation, child terminal isolation,
background continuation adoption, task ownership across turns, policy/model changes,
file output, safe forks, strict resume, paginated history, conversation rollback,
OpenCode version rejection/authentication/leases, cold discovery, and auxiliary
generation. Existing Codex, Claude, session-runtime, and registry fixtures were also
run. Server and contracts typechecks, targeted formatting/lint, and diff whitespace checks
passed. Repository-wide checks were intentionally excluded.

Selected live checks used isolated workspaces and state. Codex and OpenCode 2.0.18
completed two context-preserving turns, a busy-parent fork with completed context,
and Stop. OpenCode discovery returned models, commands, and skills; auxiliary title
generation succeeded, including the final isolated check (earlier provider runs failed or interrupted). The isolated
web app completed two OpenCode turns and retained both after reload. This verifies
the current app's OpenCode 2 path, not a V2 client cutover. Desktop shell/IPC was not
changed; the shared server/renderer path applies to both clients and explicit remote
browser connections.

Claude's live request was rejected because the account's organization has disabled
Claude subscription access. Its focused fixtures pass, including the busy-parent
completed-boundary fork, but a successful live Claude turn remains unverified.
No account settings, installed provider binaries, or live Test Rig data were changed.
