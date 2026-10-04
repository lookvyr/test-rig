# V2 port follow-up audit

October 4, 2026, against `e0b8d06f21a9ffe7a01494fb188ab0d71125ea7f` on `codex/orchestration-v2`. That commit contains the completed [fork-preservation repairs](orchestration-v2-preservation-audit.md). This pass audits the broader imported feature work and remaining acceptance in LOO-23–47. Four GPT-6.1 Sol domain audits, primary-agent verification and a separate GPT-6.1 Sol challenge review inform this record.

The original audit pass made no production changes, application servers, live provider turns, external writes or pushes. Temporary reproduction tests were removed from the checkout. The existing Linear issues were read for scope; their statuses remain unchanged. Source findings, reproduced behavior, missing implementation and unverified behavior are distinguished below.

## Findings requiring implementation or a narrow behavior decision

### Interactive queue UI superseded by steering-only follow-ups — LOO-23

The backend durably holds queued runs after Stop or restart. `ProviderRuntimeRecoveryService.ts` sets `queueHeld`; `Orchestrator.startNextQueuedRun` respects it. The shared client exposes resume/edit/reorder/cancel/promote commands in [threadCommands.ts](../../packages/client-runtime/src/state/threadCommands.ts), but neither web nor desktop calls them. The renderer also excludes undispatched queued-turn messages from its ordinary timeline in [session-logic.ts](../../apps/web/src/session-logic.ts).

Consequently, a held queue can survive correctly in storage while the user has no ordinary UI to inspect or resume it. Sending a new immediate prompt does not release those saved runs. The original audit identified this as an incomplete queue UI. The subsequent product decision supersedes that recommendation: interactive follow-ups are steering-only, with Send disabled until steering is available and drafts retained. Internal deferred work and historical queue records remain intact. A user-facing queue editor/resume flow is outside the chosen scope.

### Stop at a completion boundary can leave the remaining queue unheld — LOO-23/24

The client sends a run-specific `run.interrupt` with `holdQueue: true` in [commands.ts](../../packages/client-runtime/src/operations/commands.ts). If A completes and queued B is promoted before Stop(A) reaches [Orchestrator.ts](../../apps/server/src/orchestration-v2/Orchestrator.ts), the command rejects because A is no longer interruptible. The queue hold is never applied.

A deterministic reproduction against the actual runtime TestLayer created A, B and C, completed A, synchronously promoted B, then dispatched Stop(A). It observed a failure, B still starting, and C still queued without a hold. No timing sleeps were used.

Holding remaining queued work and interrupting B are separate choices. Refusing to retarget newer work may be intentional; the existing queue-hold expectation still needs an explicit stale-Stop rule. The smallest repair should preserve run ownership and define whether a late Stop holds C even when A has settled. Do not silently interpret this finding as permission to interrupt unrelated newer input.

### Native resolution leaves Codex MCP approval controls actionable — LOO-45

The MCP elicitation handler in [CodexAdapterV2.ts](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) stores an approval without its native JSON-RPC request identity. The `serverRequest/resolved` handler only correlates `user_input` entries, so it cannot remove or cancel the MCP approval.

A disposable replay issued a supported MCP elicitation, emitted its matching native resolution, then attempted a late answer after a protocol response barrier. The approval statuses remained `[pending]` and the late accept returned success; the expected cancellation assertion failed. This confirms the adapter lifecycle defect without claiming a live connector test. Capture native request/thread identity for elicitation and apply the existing cancellation lifecycle while preserving native-child ownership.

### Pending attachment discard has no caller ownership check — LOO-35

[attachment/handlers.ts](../../apps/server/src/mcp/toolkits/attachment/handlers.ts) checks that the caller is active, then passes its supplied attachment ID to `deletePendingAttachment`. [AttachmentUpload.ts](../../apps/server/src/assets/AttachmentUpload.ts) validates the global pending segment and deletes the matching file; issuance records no caller/thread ownership.

An authenticated caller possessing another draft's pending ID can therefore discard it. The pending-segment guard protects already-delivered assets, and this audit did not demonstrate a way to discover arbitrary pending IDs. This is a source-confirmed cleanup-ownership gap, not a claim of observed data loss or an unauthenticated exploit. Define ownership for MCP-created pending uploads and enforce it during discard/claim while retaining legitimate composer uploads and intentional transfers.

## Remaining feature delivery

| Owner  | Current result                                                                                          | Smallest remaining work                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOO-23 | Approved steering-only main/side composer flow implemented; internal queues retained.                   | Complete for the chosen scope, with live Codex proof. Claude/OpenCode live steering remains unverified in this pass.                                    |
| LOO-24 | Restart/late-event guards exist; stale Stop behavior above is reproduced.                               | Define the completion-boundary rule; finish scoped public Stop/stale-session and native lifecycle acceptance.                                           |
| LOO-26 | Normal compaction/context restoration exists. Reopened-session behavior needs the probe below.          | Reopen, compact, continue and verify app-instruction continuity.                                                                                        |
| LOO-27 | Context handoff and native-identity coverage are implemented; no additional causal defect established.  | Live cross-provider switch/back, failed injection and long-history retrieval acceptance.                                                                |
| LOO-29 | Native child send rejection and parent request ownership are present.                                   | Missing/archived parent and large-history edge acceptance; retain previous child/restart proof.                                                         |
| LOO-30 | Delegation/cohort delivery and repeated acknowledgement/disposal tests pass.                            | Resolve LOO-15 workspace/context defaults, then scoped app-owned provider/restart/nesting acceptance.                                                   |
| LOO-31 | Scoped reading and same-project messaging exist.                                                        | Explicit side-to-main accepted-delivery/disposal semantics and busy-target/retry acceptance.                                                            |
| LOO-32 | Rich composer supports files/skills; conversation-reference chips and sidebar drag payloads are absent. | Wire thread references into rich drafts, scoped retrieval and persistence.                                                                              |
| LOO-33 | Durable schedules and MCP controls exist; Settings management UI is absent.                             | Resolve LOO-14 and complete the shared management surface and saved-launch-setting acceptance.                                                          |
| LOO-34 | Backend recovery guards and independent snooze/auto-resume fields exist, default off.                   | Expose opt-in settings and per-thread recovery controls; preserve manual continuation without a trustworthy reset time.                                 |
| LOO-35 | Project/attachment/preferences tools exist; pending discard ownership gap above is established.         | Narrow ownership repair plus repository-preservation and launch-failure acceptance.                                                                     |
| LOO-36 | Worktree handoff guards pass 50 focused tests.                                                          | Actual provider continuation across handoff and setup/permission ordering. No new handoff defect established.                                           |
| LOO-39 | Unchanged bootstrap reads allocate new arrays every two seconds.                                        | Compare successful snapshots before setting React state; preserve empty-result clearing and failure retention. No reconnect/refetch defect established. |
| LOO-42 | Mounted palette rows obtain VCS/PR queries without visibility bounds.                                   | Visible-row query leases retaining cached display and hosting gates. No live subprocess/request count measured.                                         |
| LOO-43 | Server naming modes exist; Settings only exposes the retained worktree prefix.                          | Expose naming modes/instructions and prove precedence/collisions. Configured-prefix and delayed-label repairs are already committed.                    |
| LOO-45 | Native MCP approval cancellation defect reproduced above; persistent-choice encoding is present.        | Fix request correlation and replay cancellation/late-answer handling.                                                                                   |
| LOO-46 | Cross-directory ledger entries are rejected before process signaling; six native ownership tests pass.  | Dedicated copied-state proof showing the original tracked process remains alive. No destructive cleanup defect established.                             |
| LOO-47 | Imported details components exist alongside retained panel behavior.                                    | Live resize/drag/occlusion/persistence acceptance. No source-only layout defect established.                                                            |

The naming controls live in [SettingsPanels.tsx](../../apps/web/src/components/settings/SettingsPanels.tsx), with the imported fields in [settings.ts](../../packages/contracts/src/settings.ts) and [ThreadLaunchService.ts](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts). Palette query wiring is in [CommandPalette.tsx](../../apps/web/src/components/CommandPalette.tsx) and [ThreadStatusIndicators.tsx](../../apps/web/src/components/ThreadStatusIndicators.tsx). Bootstrap identity behavior is in [useDesktopLocalBootstraps.ts](../../apps/web/src/connection/useDesktopLocalBootstraps.ts) and [desktopLocal.ts](../../apps/web/src/connection/desktopLocal.ts).

## Behavior and policy limits

- **Reopened Codex compaction:** the adapter's app-context cache starts empty and only ordinary `startTurn` fills it. `resumeThread` followed immediately by `compactThread` does not seed it, so the completion reinjection returns early. The skipped restoration is source-confirmed; actual native instruction loss on a following turn is unverified. This concerns Test Rig's injected developer context, not the native base system prompt. Keep this as a targeted LOO-26 probe rather than claiming a reproduced loss.
- **Stale foreground sessions:** public interrupt rejects a running projection whose session is missing before the lower-level already-stopped handling can run. No normal unreconciled loss that stays permanently busy was established. A permanent-spinner claim would overstate this evidence.
- **Scheduling:** current `ScheduledTaskService` reports success when dispatch is accepted, releases its in-memory reservation after dispatch, and sends to existing threads with mode `auto`, which can steer busy work. New-thread launches carry saved permission/interaction settings; bound-thread sends use the existing thread path. Fixed-time schedules use server-local time, skip occurrences more than ten minutes late, and overdue intervals run once. These are current semantics for LOO-14 to decide, not approved new defaults. The server must be running; no OS wake/cloud service is implied.
- **Delegation and coordination:** LOO-15 defaults remain undecided. Passing native-child tests does not establish app-owned cross-provider delegation. The 16-test coordination batch is useful current proof, not a full restart/live matrix. Same-project send authority remains distinct from cross-project readable references.

## Executed verification

| Check                                      | Result and meaning                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime queue/usage-limit selection        | 30 passed, 28 skipped. Existing holds/order/recovery/precedence checks pass.                                                                                                                                                                                                                                                             |
| Deterministic stale Stop reproduction      | 1 passed, 58 skipped. Asserts current failure/unheld queue; it does not assert corrected behavior.                                                                                                                                                                                                                                       |
| Queue/control-read/recovery/control suites | 5 passed, 1 failed. The control-reads test fails after a deliberately malformed historical assistant fixture; this is a focused verification regression until a normal user path is established.                                                                                                                                         |
| Existing selected Codex compaction tests   | 2 passed, 124 skipped. Ordinary context restoration and direct compaction do not prove reopened-session continuity.                                                                                                                                                                                                                      |
| New disposable Codex elicitation replay    | Expected cancellation test fails; records pending approval and successful late answer after native resolution. Temporary test removed.                                                                                                                                                                                                   |
| MCP/delegated delivery/project handlers    | 3 suites, 16 passed. Includes repeated acknowledgement/disposal; no real provider processes started.                                                                                                                                                                                                                                     |
| Worktree MCP service                       | 50 passed. No live handoff claimed.                                                                                                                                                                                                                                                                                                      |
| OpenCode server ledger                     | 6 passed after an approved retry outside the sandbox. Initial sandbox attempt could not spawn its test children. No dedicated copied-state case claimed.                                                                                                                                                                                 |
| Schedule calculations/scheduler/service    | Original batch: 12 passed, 3 failed. All three service tests import the legacy SQLite layer and fail with `no such table: scheduled_tasks`. A temporary copy changing only that import to V2 persistence passed the same three tests. This identifies a stale test fixture, not a production scheduling failure. Temporary copy removed. |

Counts include selected and disposable runs and should not be presented as one comprehensive suite. No repository-wide tests or repeated preservation UI pass were run. Existing live evidence remains attributed to [nightly sync](orchestration-v2-nightly-sync.md).

## Suggested next slices

1. Repair native MCP elicitation cancellation (LOO-45) and add the focused replay permanently.
2. Define and verify the stale-Stop rule for internal deferred work (LOO-24). The approved steering-only composer flow (LOO-23) is implemented; do not add a user-facing queue editor.
3. Probe reopened compaction and cross-provider continuation before expanding collaboration features (LOO-26/27).
4. Complete pending-asset ownership and expose the remaining controls, with policy decisions for scheduling/delegation made before accepting those flows.

Rewind, merge-back, OpenCode 1 and excluded cloud/provider services remain outside scope. The earlier preservation acceptance stands with its recorded limits; this audit identifies unfinished broader V2 work.

## Approved composer adaptation

After the audit, the product decision narrowed LOO-23 to interactive follow-ups:
idle sends start a turn, active follow-ups steer, and unavailable steering keeps
Send disabled with the draft intact. No user-facing queue controls are planned.
Internal notifications, deferred work, and stored queue records remain supported.
The composer boundary now sends explicit steering intent rather than automatic
queue fallback, and both main and side-chat submit handlers check live native
turn readiness. Pending native questions retain their existing answer path.

Verification: 47 focused tests passed across dispatch policy, client commands,
readiness and composer actions; web and client-runtime typechecks passed, and
focused lint/format checks passed with existing React lint warnings. Independent
GPT-6.1 Sol review found no actionable regression. A live Codex turn accepted a
button-submitted follow-up as Steer and answered STEERED_OK. In the side chat,
Send was disabled during startup and Enter preserved the draft without a warning;
after readiness changed, Enter submitted that same draft as Steer and the side chat
answered SIDE_STEERED_OK. Native smoke
coverage used Codex; the shared capability gate covers Claude and OpenCode in
source, without claiming live steering tests for those providers in this pass.
There are no wire-schema or desktop-shell changes. Completion-boundary policy
continues to resolve a steer intent as a new turn when no active run remains.
Existing selection-change restart behavior remains in place.
