# Test Rig V2 coordination and scheduling audit — October 6, 2026

Audited `/Users/smills/REPOS/test-rig` at `2cd9bf400cefedd19206b09ff4f8d880a176d915`, branch `codex/orchestration-v2`, against upstream nightly `v0.0.46-nightly.20261006.2735` (`fd1c3386c`) and its available sources. Read AGENTS.md/FORK.md, issue descriptions, and current issue comments. No provider calls, servers, Linear changes, commits, or persistent repository edits. Working tree clean after temporary reproduction test removal.

## Findings and narrow followups

### F1 — P2: Missed fixed-time rescheduling overwrites an intervening schedule edit (confirmed deterministically)

`apps/server/src/scheduledTasks/ScheduledTaskService.ts:611-615` updates `next_run_at` from a stale task with only `task_id` in the WHERE clause. `runDueTasks` snapshots all due tasks, then handles them serially (`:624-644`). Unlike `runTask`, the missed-fixed-time branch neither re-reads the task nor guards its write against an intervening edit.

Concrete sequence:

1. At `2026-10-06T12:00Z`, one due interval task blocks in dispatch acceptance. A later due fixed-time task is already in the poll's snapshot and is more than ten minutes late.
2. While the first dispatch is blocked, change the second task to an interval of two minutes. The save returns the correct new `next_run_at=2026-10-06T12:02Z`.
3. Release the first dispatch. The poll processes its old snapshot of the second task through `rescheduleMissedRun` and overwrites the saved next run with the old fixed-time occurrence (`2026-10-06T15:00Z` in this machine's zone), although the row's schedule is still a two-minute interval.

The new interval can now be postponed by hours. Pause/re-enable and replacement races can also pass through this stale update, but the reported failure is the directly reproduced edit case.

Proof: a temporary Effect/V2 memory SQLite test used `Deferred` for the blocked first dispatch and a third dispatch as the drain receipt, with a frozen fake clock. It failed only the final due-time assertion: expected `2026-10-06T12:02:00.000Z`, received `2026-10-06T15:00:00.000Z`. No sleeps or polling were used. Reproduction preserved at `/private/tmp/testrig-audit-schedule-race.test.ts`; original temporary location was `apps/server/src/scheduledTasks/ScheduledTaskAuditTemporary.test.ts`, now removed. To rerun, copy the preserved file to that repository path and run the command below, then remove it.

Recommended followup: revalidate the missed-run candidate and use a conditional write against the observed schedule/enabled/due identity, so editing, pausing, deleting, or replacing the task wins. Add the deterministic missed-run race test. This is a narrow repair to LOO-33's accepted feature, not a reason to reopen the scheduling-policy decision.

### F2 — P2: Automatic delegated completions can interrupt Claude's pending tools (high-confidence upstream fix missing; not live-reproduced here)

Local `apps/server/src/orchestration-v2/Orchestrator.ts:4620-4652` reroutes an automatic child completion to active steering whenever the live session reports `supportsActiveSteering`. Claude reports that capability at `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:201`; its steering message uses `priority: "now"` at `:7289-7305`.

Upstream `1beb0355d` adds `activeSteeringInterruptsTools: true` to Claude's capabilities and prevents automatic mailbox steering for such sessions. Current nightly owns the guard at `apps/server/src/orchestration-v2/Orchestrator.ts:4675`, with the capability at `Adapters/ClaudeAdapterV2.ts:202`. Its deterministic `ClaudeAutomaticDelivery.integration.test.ts:123-158,354-392` models captured native pending-tool cancellation behavior: explicit user steering can cancel tools; automatic child completion and scheduled work must queue instead.

Test Rig already ported the scheduled-task `mode: "queue"` half (`ScheduledTaskService.ts:549`), but not the delegated-completion capability/guard or cancelled-tool metadata normalization. Recommended adapted port: take the capability and automatic-delivery guard with focused Claude coverage. Keep explicit interactive steering behavior as FORK.md requires. This belongs to LOO-30 reliability; it is independent of the approved nonrecursive Stop policy.

### F3 — P2: A repaired provider can remain unavailable to unattended delegation until a client refreshes it (source-backed upstream fix missing)

Local `apps/server/src/mcp/OrchestratorMcpService.ts:897` reads the cached provider list. `resolveTarget` fails unavailable snapshots at `:965-973`; `delegateTask` and top-level creation call it directly (`:1397`, `:1608`) without a one-time refresh. The registry exposes `refreshInstance` (`apps/server/src/provider/Layers/ProviderRegistry.ts:487-496`) but `getProviders` only returns the cached Ref (`:707`). Background provider refresh depends on provider-status demand (`apps/server/src/provider/makeManagedServerProvider.ts:212-219,265-272`).

A provider that was unauthenticated or missing and is repaired outside the app can therefore still be rejected by an unattended parent with a registered adapter. Upstream `cbb731beb` fixes this with a one-time `refreshInstance` retry for an explicitly named or inherited instance before rejecting `provider_unavailable`; nightly `OrchestratorMcpService.ts:1035-1059,1736,1968`. Recommended adapted port preserves disabled/unapproved-provider fail-closed checks after refresh; no alternate provider should be silently substituted for an explicitly named instance.

No live auth/install change was performed. The source shows the missing recheck and the owning cache/demand behavior; classify as a targeted upstream reliability followup rather than reopening all delegation acceptance.

### F4 — Performance intake candidate: blocking task waits still poll at 20 Hz

Local `apps/server/src/mcp/OrchestratorMcpService.ts:1177-1184` runs `readTask` every 50ms until completion/timeout. Each read loads parent records, child controls, and child result records (`:1039-1075`), even when unchanged. Upstream `c138163c8` replaces this with parent/child event subscriptions (`nightly/OrchestratorMcpService.ts:93,1334-1380`). It also subscribes before re-reading so completion cannot be missed. This is a useful cohesive adapted port for performance. No timing benchmark was performed, and this is not classified as a correctness failure.

## Per-issue verdicts

| Issue  | Verdict against current source and newer comments                                          | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LOO-14 | Complete policy decision; no decision reopening recommended.                               | `docs/internals/scheduled-task-policy.md:3-25` and Oct 6 comment record queued busy-thread delivery, overlap allowed, dispatch status, server-local timezone, 10-minute fixed-time grace, one catch-up interval, explicit opt-in. Service uses queue at `:549`; Schedule.ts `:78-92` owns grace. Older description's no-overlap recommendation is superseded.                                                                                                                                                                                                                  |
| LOO-15 | Complete defaults decision; no decision reopening recommended.                             | `docs/internals/orchestration-v2-followup-audit.md:451-485`, Oct 6 completion comment, and `docs/user/delegated-agents.md:11-40`. Child thread derives from parent checkout; child initial message is only task text with no attachments (`Orchestrator.ts:6252-6267,6373-6384`). No history/workspace toggle is promised; isolation uses explicitly requested independent worktree threads.                                                                                                                                                                                   |
| LOO-28 | Current fork behavior matches selected scope; no new blocker found.                        | `ThreadForkService.ts:88-115` creates separate durable lineage and clears temporary side ownership, archive/settle/snooze/deletion fields. Direct merge-back rejects at `Orchestrator.ts:9208-9213`. Focused fork plan/execution suites pass. Prior comment documents live Codex/Claude historical boundaries and restart; OpenCode live limitation remains accurately stated. Cross-provider continuation belongs to LOO-27.                                                                                                                                                  |
| LOO-30 | Implemented and accepted in Oct 6 comments; propose F2/F3 as narrow reliability followups. | Comment identifies d4c806bd9, live Codex→OpenCode→Codex nesting, repeated result reads, Stop/cancel and restart. Current MCP tests enforce provider selection and permission ceilings (`OrchestratorMcpService.test.ts:1042-1118`) and timeout preserving child (`:1121+`). Durable delivery tests and continuation tests pass. Parent Stop suppressing wakes without recursively cancelling children is explicit (`docs/user/delegated-agents.md:61-65`); upstream cascade is a policy difference, not automatically a defect. This audit does not reproduce the live matrix. |
| LOO-31 | Scoped requested messaging is present; no new blocker found.                               | `OrchestratorMcpService.ts:827-847` validates current caller ownership and permission ceilings; sends/interrupts use it at `:1858,1925`. Same-project send scope remains separate from references. `threadAccess.ts:40-101` enforces active callers and permission ceilings for toolkit mutations. Focused MCP service/history and runtime tests pass; newer comments record real Codex/Claude side sends, retries and disposal. No new live/ambiguous-title acceptance claim.                                                                                                 |
| LOO-32 | Rich composer references are present; no new blocker found.                                | `packages/client-runtime/src/composerThreadItems.ts:26-50` scopes title matches by environment, skips self/archive; composerMessage.ts `:18-35` carries selected records and rejects foreign environments. MCP user-attached references grant cross-project reading only (`OrchestratorMcpService.ts:850-895`), sends remain project scoped. Matcher/send/drag tests pass. Prior lifecycle/live evidence remains scoped; no desktop shell changes needed.                                                                                                                      |
| LOO-33 | Settings management is implemented/accepted; confirmed F1 warrants a narrow repair.        | Oct 6 comments supersede old open description and identify ee2665910 with live Codex creation/edit/pause/run/delete/no-project acceptance. `ScheduledTasksSettings.tsx:438+` distinguishes Sent/Dispatching/Dispatch failed. `ScheduledTaskService.ts:504-597` protects in-flight acceptance edits and has saved model/permissions/workspace launches (`:520-536`), restart recovery (`:647-699`), and shared persistence/stream. All existing focused scheduling tests pass, but F1 reproduces uncovered missed-run edit race.                                                |
| LOO-34 | Operational quota recovery is present, independently opt-in, with no new blocker found.    | UsageLimitRecoveryWorker.ts `:17-71` trusts classified reset identity, avoids stale reset loops, preserves cancellation and snooze-only choices; Orchestrator.ts `:2558-2588,4390-4430` rechecks arms/delivery against current state. Runtime-layer tests cover cancel/new input/archive/settlement/provider change/ordering/independence; banner tests pass. Provider reset parsing suites pass. OpenCode remains manual retry because reset timestamps are unavailable, as documented. No billing/pricing UI required.                                                       |

## Intentional upstream differences

- Do not restore interactive composer queuing, rewind, checkpoint chat restoration, or conversation merge-back. FORK.md owns these exclusions.
- `f32c23cf1` upstream Stop recursively stops delegated children and PR watches. Current Test Rig decision documented by the Oct 6 LOO-30 comment and user docs leaves delegated children independent. Keep this distinction when assessing LOO-24/30; adopting cascade needs a product choice.
- New webhook scheduling is explicitly outside the Oct 6 interval/fixed-time policy (`docs/internals/scheduled-task-policy.md:24-25`). External OAuth client/explicit-project expansion is not automatically required by these completed tickets.
- Native `/goal` is new upstream intake beyond this issue set; no claim of a gap against existing coordination acceptance.

## Commands and verification

Existing test batch 1 (9 files, 68 tests passed):

```sh
./node_modules/.bin/vp test run apps/server/src/scheduledTasks/Schedule.test.ts apps/server/src/scheduledTasks/ScheduledTaskService.test.ts apps/server/src/scheduling/Scheduler.test.ts apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts apps/server/src/mcp/OrchestratorMcpService.test.ts apps/server/src/mcp/OrchestratorMcpService.history.test.ts apps/server/src/orchestration-v2/ThreadForkService.test.ts apps/server/src/orchestration-v2/ThreadFork.execution.test.ts apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.test.ts
```

Existing test batch 2 (12 files, 171 tests passed):

```sh
./node_modules/.bin/vp test run apps/server/src/orchestration-v2/runtimeLayer.test.ts apps/server/src/orchestration-v2/ProjectionStore.test.ts apps/server/src/orchestration-v2/ProviderContinuationService.test.ts apps/server/src/orchestration-v2/SubagentProjection.test.ts apps/server/src/mcp/toolkits/orchestrator/tools.test.ts apps/server/src/provider/providerUsageLimits.test.ts apps/server/src/provider/Layers/codexUsageLimits.test.ts apps/server/src/provider/Layers/claudeUsageLimits.test.ts packages/client-runtime/src/composerThreadItems.test.ts apps/web/src/components/chat/composerMessage.test.ts apps/web/src/components/chat/composerMentionDrag.test.ts apps/web/src/components/chat/UsageLimitRecoveryBanner.test.tsx
```

F1 proof (1 deliberate regression assertion, failed as expected):

```sh
./node_modules/.bin/vp test run apps/server/src/scheduledTasks/ScheduledTaskAuditTemporary.test.ts
```

`vp` was absent from shell PATH; the repository's existing `./node_modules/.bin/vp` worked. 239 existing focused tests passed across 21 files. No broad check/typecheck, live provider quota exhaustion, browser/server launch, Electron smoke, or remote-host test was performed. Prior live evidence is identified from source/issue comments and not claimed as newly reproduced. Source comparison commands included `git show cbb731beb`, `git show 1beb0355d`, `git show --stat f32c23cf1`, `git show --stat c138163c8`, and direct nightly source inspection. All refs in findings are from the audited current source or identified pinned nightly.
