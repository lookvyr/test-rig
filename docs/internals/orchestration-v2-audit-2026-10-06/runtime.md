# Runtime, persistence, recovery and bounded transport audit

Audit date: 2026-10-06. Test Rig HEAD `2cd9bf400cefedd19206b09ff4f8d880a176d915`, branch `codex/orchestration-v2`. Read AGENTS.md and FORK.md. No production edits, commits, servers, provider launches, Linear mutations, or live database access. Temporary regression source was removed; audit scratch was removed. The parent later added the untracked audit-doc directory; there are no subagent-owned checkout changes.

Compared upstream change lists and relevant source at nightly `fd1c3386c` (`v0.0.46-nightly.20261006.2735`) and main `d8d037eae1b77a77f372fd1afd2662a31ebe37c8`. Linear full issue records at `/private/tmp/testrig-audit-20261006-linear-full.json` were read for LOO-17/19/21/24. Their top completion notes supersede historical staged, unpushed, and backlog text.

## Confirmed findings

Highest-priority intake candidates are RPC defect isolation (`8ddf200e8`), release of a closed stream's blocked reader (`eac52f008`), the SQLite transaction lock/classification repair (`0fe4fa40f`), and app-owned delegation preservation during restart (`5108c978b`). Each has a narrow reproduction on the current runtime/dependency. The stalled-run Stop and shared worker findings below are also confirmed. All repro scripts/test source are saved under `/private/tmp`.

### 0. A defective RPC handler ends sibling subscriptions on the same connection (LOO-19/21 foundation)

`apps/server/src/ws.ts:1407-1409` calls `RpcServer.toHttpEffectWebsocket` with `disableTracing` only. Installed Effect rc115's `RpcServer.ts:119,299-305` defaults disableFatalDefects to false and sends a connection-level Defect frame for a handler defect. Its RpcClient handles that by ending all pending requests.

`node /private/tmp/testrig-runtime-rpc-repro.mjs` pairs the installed RPC server/client, starts a stream, reads 1, then runs a handler returning Effect.die. It yields `{"first":1,"boomExit":"Failure","next":"subscription ended"}`. The identical pairing with `AUDIT_DISABLE_FATAL=true` yields `next:2`; the same defective handler fails only its request. This uses receipt/queue signals, no sleep or network socket.

Upstream main `8ddf200e8f637eaf9a4f0d3036ece8f1d3869d10` (#15515) sets disableFatalDefects and logs isolated handler defects through DefectReporter. Installed rc115 already supports the option, so the repair need not await a full Effect upgrade. The upstream ACP portion is dormant/excluded and need not be ported for the local WebSocket repair.

### 1. A lost terminal write can leave a run that Stop cannot recover (LOO-24, adapted upstream intake recommended)

Current `Orchestrator.ts:8038-8059` rejects `run.interrupt` when a still-running provider turn has no active session. The lower-level already-stopped behavior in `ProviderTurnControlService.ts:143-166` cannot run because dispatch rejects first. The `settleOnly` branch at `Orchestrator.ts:8005-8034` only covers a non-running provider turn, not this stale-running case.

Even when an interrupt returned successfully but the terminal event was not persisted, its `thread.background-work.settle` follow-up does not repair the root run: `Orchestrator.ts:7716-7764` loads only runs/attempts/background items/provider threads, then returns when _any_ run is preparing/starting/running, including the target run itself. Consequently the run and attempt can remain running until a backend restart reconciles them.

Deterministic reproduction used the existing production runtime TestLayer, created a thread/message, then persisted a running run, attempt, root node and provider turn with a missing session reference. This models a terminal write lost after provider/process loss; it does **not** claim normal session release fails. `run.interrupt` failed with `OrchestratorDispatchError`; explicit `thread.background-work.settle` left both run and attempt running. One audit test passed asserting that observed behavior. The runnable source is archived at `/private/tmp/testrig-runtime-stop-repro.test.ts` (copy temporarily to `apps/server/src/orchestration-v2/AuditRuntimeRecovery.tmp.test.ts`, run the focused command below, then remove it).

Upstream `a7a2230c33fbec9d6616a5de26f09e1fa8856c05` (#15442) adds `settleInterruptedRun`, handles a dead session locally, and makes the successful-interrupt follow-up terminalize a stale owning attempt. It also guards late terminal writes and persists their checkpoint effects atomically. This is relevant code to adapt, preserving Test Rig's explicitly accepted run-scoped stale Stop behavior. Upstream uses wall-clock polling in the control service, so do not blindly copy that part without considering Test Rig's receipt/drain test requirement.

Scope: this extends the residual failure acceptance of LOO-24. Existing Done status remains supportable for the user's scoped successful Stop/graceful replacement acceptance, which explicitly did not cover crash injection or lost persistence. It should not be described as full crash/disk-failure recovery.

### 2. DrainableWorker dies on a processor failure and leaves future work/drain stranded (foundation helper, direct upstream repair candidate)

`packages/shared/src/DrainableWorker.ts:47-55` runs `process(a)` directly under `Effect.forever` without containing an item's failure/defect/self-interruption. The current item's finalizer decrements outstanding, but later enqueued items remain outstanding after the fiber dies. `:44` also only shuts down the queue without clearing/decrementing dropped work; `:63-66` increments the outstanding count even if a closed queue refuses an offer.

Reproduced without checkout edits using `/private/tmp/testrig-runtime-worker-repro.mjs`:

```
node /private/tmp/testrig-runtime-worker-repro.mjs
{"workerExit":"Failure","processed":[],"drainResolved":false}
```

The script enqueues an item returning `Effect.fail`, followed by a valid item, waits for the actual worker fiber's exit, then inspects the drain fiber immediately; no timing sleeps/polling.

Production consumers include `ThreadSettlementService.ts:515`, `PullRequestSyncReactor.ts:332`, `ThreadPullRequestService.ts:355`. Those callers contain most ordinary failures, so the reproduction establishes the helper defect, **not** a claim that any ordinary PR request currently kills these workers. Settlement and PR refresh intentionally propagate pure interruption, which the helper does not distinguish from shutdown.

Upstream `24e4b62c883eb67251bdfb07d2bf22cfd3987820` (#16223) contains per-item causes, clears dropped queue items on shutdown and counts only accepted enqueues, with focused failure/defect/self-interruption/shutdown tests. This has no excluded cloud/provider dependency.

## Verdict per issue

### LOO-17 — Done supported for basic fork-aware import

- Production V2 layer uses `statev2.sqlite` and copies from sibling `state.sqlite` (`persistence/Layers/V2Sqlite.ts:20-28`). It never starts V2 against the legacy filename.
- `initializeV2Database.ts:26-46` reuses an existing destination, opens legacy source read-only, takes a Node SQLite backup into a scoped temporary directory, and hard-links only the finished snapshot without overwriting another destination.
- `V2Migrations.ts:9-23` retains migration entries 1-39 and appends fork-aware 40-43. Historical 038 side chats and 039 PR association are not renumbered/replaced.
- `legacy/LegacyV1ThreadImporter.ts:583,674` excludes legacy ephemeral side rows; `:65,223,475` carries PR association including unlinked choice. Lazy import has durable transcript completion bookkeeping at `:695-757`, and startup reconciles shells before background import (`serverRuntimeStartup.ts:343,366`).
- Six `legacy/ForkMigration.test.ts` tests passed. The actual fixtures cover migration ledger preservation, long transcript/messages/attachments/context preparation, partial import and restart idempotency, failed/orphan snapshots/WAL commits, metadata/PR opt-out, exclusion of native legacy sessions/checkpoints and side chats, and production-layer reopen (`:36,104,280,354,402,510`).
- No new realistic copied-live-data or provider continuation pass was performed in this audit. Existing Linear/docs recorded live continuation remains historical evidence, not rerun evidence. Richer legacy activities, native-session continuity and old checkpoint actions are intentionally excluded by the approved basic-import/FORK policy.

### LOO-19 — Done supported for core storage/effects; worker helper repair identified

- `EventSink.ts:239-268` serializes post-commit publication; `:518-610` commits receipts, events, projections and effects transactionally and returns existing command receipts; cancelled effects are signalled after commit.
- `EventSink.ts:395-445,449-504` guards stale attempt/provider-thread ownership in the transaction.
- `EffectOutbox.ts:112-130,475-516` separates replay-safe and process-bound effects. Process-bound starts/interrupts/steers/restarts/responses are cancelled on process loss; only replay-safe cleanup/continuation/checkpoint/title work is requeued. `:295-332` serializes critical effects per thread and gives title generation a separate lane.
- `EffectWorker.ts:211-250` arms cancellation before authoritative reread and races executor against it. `:194-200` avoids requeueing non-safe effects after successful execution/failed settlement. Retry scheduling is durable; running work is deliberately not reclaimed solely because its process-local lease expires (`FoundationPersistence.test.ts:2581`). This avoids unsafe duplicate execution, though it does not imply generic exactly-once tooling.
- `ProjectionMaintenance.ts:75-127` verifies schema/sequence/thread membership/decodeability; `:139-186` rebuilds through 500-event pages in a transaction. It is supplied in runtimeLayer.ts but there is no automatic startup verify/rebuild caller in the current production source. The acceptance says verification/rebuild work, which focused tests establish; it should not be expanded into a claim that startup automatically repairs arbitrary corruption.
- `ProjectionStore.ts:3433-3553,3822-4020` finds unfinished recovery candidates and reads only relevant state instead of full settled transcripts; regression fixtures deliberately put malformed irrelevant historical bodies outside those reads.
- FoundationPersistence, EffectWorker and ProjectionRecovery all passed as part of the first 87-test batch. The separate shared worker reproduction above identifies a narrow intake improvement. No arbitrary provider/tool exactly-once or disk-corruption guarantee is claimed.

### LOO-21 — Done supported with documented large-complete-turn exception

- Contract protocol version is 2 (`packages/contracts/src/environment.ts:6-9`); WebSocket rejects mismatched/missing version with 426 and a compatibility message before upgrade (`apps/server/src/ws.ts:1382-1395`). Shared authorization blocks a mismatched descriptor (`packages/client-runtime/src/authorization/service.ts:65-71`); HTTP uses the protocol header contract (`contracts/src/environmentHttp.ts:47`). Shared client logic covers renderer/Electron paths.
- Reconnect replay caps event count and encoded/raw bytes (`ThreadStream.ts:12-22,100-116`). Live buffered RPC retention is counted by item and projected bytes and closes overloaded consumers (`LiveStreamBudget.ts:44-98,277-348`). Internal subscriptions are intentionally not disconnected under load; workers filter their event types before retention.
- HTTP and socket fallbacks use common window/paging helpers (`http.ts:111-149,158-220`; `ThreadStream.ts:39-58`). Tool outputs are omitted before transmission; persistence keeps originals, covered by ThreadTransportPerformance tests.
- **Limit, not a newly discovered defect:** complete ordinary user turns intentionally bypass maxItems/maxEncodedBytes (`threadHistoryPaging.ts:181-212`), and SQL explicitly uses unlimited rows inside the selected turn window (`ProjectionStore.ts:2717-2723`). Recent = ten user turns, older = twenty, with 150 raw-turn ceiling. A single large turn can exceed 1 MiB; `payloadBudgetExceeded` reports this without hard rejection. This is already documented in `docs/internals/orchestration-v2-cutover.md:32-36` and established by existing paging tests. Strict per-frame/byte boundedness should not be claimed.
- Whole-thread Find uses persisted paged search/context, including unloaded and inherited text (`ThreadFind.ts:17-67`); ThreadFind tests reject full-projection hydration.
- ThreadTransportPerformance 3 tests; paging/ThreadStream/Find/LiveStream tests included in second 83-test batch passed. No browser/native desktop, remote route or performance timing pass was run by this audit.

### LOO-24 — Scoped Done supported; additional lost-terminal-write recovery gap confirmed

- Read the latest October 5 Linear completion note. Browser Stop(A) after A completes/B starts explicitly rejects and does not interrupt B or hold C; MCP explicit completed target returns already_terminal. The earlier audit's unheld-C observation was explicitly accepted and is not an unresolved bug.
- `runtimeLayer.test.ts:3421` reproduces accepted A/B/C ownership and checks event/projection invariance plus later C promotion. Selected runtime Stop/public controls passed (9 tests, 69 skipped, last batch).
- Recovery cancels current runs/requests/stale items, clears pending background rosters, stops sessions, holds queued work, and records bounded lost-work notes (`ProviderRuntimeRecoveryService.ts:168-654`). Startup runs it before starting effects (`serverRuntimeStartup.ts:360-361`); shutdown stops worker scope, snapshots continuation intent, shuts provider sessions and reconciles (`:296-304`).
- ProviderRuntimeRecoveryService/regression, ProviderTurnControlService, RestartContinuation/BackgroundNote and DelegatedCompletionDelivery focused tests passed in the first/second batches. They prove fresh request lifetimes, older/native child ownership, continuation user precedence and repeat delivery guards.
- This audit confirmed the lost-session/lost-terminal-write repair gap above. Normal release/restart paths already terminalize; no fresh live crash/persistence-loss injection was performed.
- Additional upstream behavior changes are not silent bug fixes to adopt wholesale: `253dea360` stops restarting completed/settled runs whose background work was lost, while Test Rig's `RestartContinuation.test.ts:156-187` explicitly allows those under continueThreadsAfterServerUpdate. `f32c23cf1` introduces thread.stop reaching delegated tasks and PR watches, broader than current run-scoped Stop. These warrant explicit fit/adaptation analysis, preserving existing accepted semantics.

## Focused commands and outcomes

Initial plain `vp` failed because it was absent from PATH; repository `node_modules/.bin/vp` worked. No dependency install performed.

1. `node_modules/.bin/vp test run apps/server/src/orchestration-v2/FoundationPersistence.test.ts apps/server/src/orchestration-v2/EffectWorker.test.ts apps/server/src/orchestration-v2/ProjectionRecovery.test.ts apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.test.ts apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.regression.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts apps/server/src/orchestration-v2/ThreadTransportPerformance.test.ts apps/server/src/orchestration-v2/legacy/ForkMigration.test.ts apps/server/src/orchestration-v2/Orchestrator.migration.test.ts` → 10 files, **87 passed**.
2. `node_modules/.bin/vp test run apps/server/src/orchestration-v2/threadHistoryPaging.test.ts apps/server/src/orchestration-v2/ThreadStream.test.ts apps/server/src/orchestration-v2/ThreadFind.test.ts apps/server/src/orchestration-v2/LiveStreamBudget.test.ts apps/server/src/orchestration-v2/RestartContinuation.test.ts apps/server/src/orchestration-v2/RestartBackgroundNote.test.ts apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts apps/server/src/orchestration-v2/ThreadLifecycleService.test.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts` → 9 files, **83 passed**.
3. Temporary stopped-session regression `node_modules/.bin/vp test run apps/server/src/orchestration-v2/AuditRuntimeRecovery.tmp.test.ts` → **1 passed** asserting observed failure; archived under /private/tmp and removed from checkout.
4. `node_modules/.bin/vp test run apps/server/src/orchestration-v2/runtimeLayer.test.ts -t 'late Stop|queue after a user interrupts|interrupts|settles|Stop' apps/server/src/orchestration-v2/ThreadManagementService.test.ts` → **9 passed**, 69 skipped.
5. `node /private/tmp/testrig-runtime-worker-repro.mjs` → worker failure reproduced, later item not processed, drain unresolved.

These are selected deterministic checks only, not repo-wide validation, provider acceptance, native desktop acceptance or release sign-off.

## Additional earlier-upstream coverage and reproductions

### SQLite write-lock upgrade failure — 0fe4fa40f is absent, not already integrated

There are two implementations: `apps/server/src/persistence/NodeSqliteClient.ts:277-286` is the production V2 owning client, and `packages/shared/src/nodeSqliteClient.ts:272-281` is shared tooling. Both omit beginTransaction, so installed Effect's SqlClient.ts:171 defaults to deferred BEGIN. Both pass Node SQLite errors straight to classifySqliteError (`server:176`, `shared:171`), which reads errno while node:sqlite uses errcode.

`node /private/tmp/testrig-runtime-sqlite-repro.mjs` opens a disposable WAL database, runs a read in the actual production SQL client's transaction, commits an update on another Node SQLite connection, then attempts the transaction's write. Output is `outsideCommit:true`, `exit:Failure`, `UnknownError`, underlying `database is locked`. No live DB or dev server is involved. This proves a read-to-write upgrade conflict bypassing normal lock wait, not normal single-process write contention.

Upstream `0fe4fa40fe65ac9545621a65633f08d9fa29fd0d` (#15488) uses BEGIN IMMEDIATE on writable connections and preserves deferred BEGIN for read-only connections, and maps errcode to errno for typed lock/constraint reasons. Adapt both owning clients if keeping both. Longer block/wait characteristics should be assessed because Node SQLite is synchronous; the reproduction only establishes the known lost-upgrade problem.

### Closed busy-stream reader — eac52f008 owning dependency patch is absent

`patches/effect@4.0.0-rc.115.patch` and installed `effect/dist/unstable/rpc/RpcClient.js:158-164` delete the stream entry and send Interrupt without Queue.shutdown(entry.queue). A transport fiber blocked offering a full incoming batch is therefore not released by closing the stream.

`node /private/tmp/testrig-runtime-busy-stream-repro.mjs` starts the installed client stream, feeds one acknowledged value to start its consumer, parks that consumer, starts a writer with a batch larger than the bounded buffer, then interrupts the consumer and examines the writer fiber: `{"readerReleasedAfterStreamClosed":false}`. The script subsequently interrupts the writer for cleanup. No sleeps, real sockets or server were used. This proves the blocked reader; the broader connection-drop behavior follows the transport owner and upstream session regression, not a fresh browser observation.

Upstream `eac52f0087d9ba5dee5542f24788d1482affae43` (#15563) adds Queue.shutdown before sendInterrupt in the owning Effect patch and a real RpcSessionFactory full-buffer regression. This is different from RPC defective-handler isolation: both issues exist independently on rc115.

### App-owned delegated task records are prematurely cancelled — 5108c978b is only partially represented

Current recovery treats all unfinished subagents as dead provider-native work, without origin/child ownership exclusions (`ProviderRuntimeRecoveryService.ts:332-367,408-422,445-504`). The producer makes app-owned tasks with a durable child thread (`Orchestrator.ts:6273,6325`), so these records are reachable in normal delegation, and the recovery query includes their open items/nodes (`ProjectionStore.ts:3822-4020`). Their child threads can be independently recovered/continued, so parent recovery must not invent the child's terminal outcome.

The upstream regression from `5108c978b` was run against current service/imports. One test **failed**: actual cancelled touched IDs included all three app-owned settled task, app-owned running task and provider-native task, while upstream expects only provider-native. Source is `/private/tmp/testrig-runtime-delegated-recovery-repro.test.ts`; copy temporarily to `apps/server/src/orchestration-v2/AuditDelegatedRecovery.tmp.test.ts` to rerun, then remove.

Evidence limits: the test directly invokes the real recovery service with projection/event-sink mocks; it proves erroneous cancellation events for durable app-owned child tasks. This audit did not demonstrate the full later resumed-child completion sequence or duplicate delivery in a live provider. Adapt the upstream origin/child exclusions plus terminal child reconciliation and keep user precedence. This is a concrete LOO-24/30 restart ownership gap, not proof every part of 5108c978b is absent. Existing local continuation/background-note/delegated-delivery guards are already present and pass their focused tests.

### Agent-only child history bypasses its normal page cap — 88744f3dd absent

Current `threadHistoryPaging.ts:190` tests any turn_start (including createdBy agent) before bypassing item/byte limits. SQL similarly switches to unlimited selected rows for any turn anchor (`ProjectionStore.ts:2717-2723`) and the local-window fallback tests isThreadHistoryTurnStart (`:3215`). The approved/documented exception is complete ordinary user turns, but agent-only child transcripts should use the row/byte budget.

The upstream `88744f3ddba9d3883ba631f0f4801f1a97fe77ce` regression on current helper (one agent-created turn_start followed by 90 commands) **failed**: expected75, actual91. Source saved at `/private/tmp/testrig-runtime-agent-history-repro.test.ts`. Current behavior loads the entire single agent turn, not a bounded recent75 plus older-page cursor. No transcript loss was reproduced; this is a narrower resource/paging regression than the upstream commit title. The earlier raw/background 150-turn fan-out ceiling test passing does not cover rows within one agent turn.

The upstream repair changes turn-limit detection, SQL boundary/fallback and memory implementation to count actual user turns. This leaves ordinary user complete-turn semantics intact. In LOO-21, distinguish this agent-only gap from the already documented ordinary-user large-turn exception.

### Cheaper shell refreshes — c138163c8 candidate, source-confirmed cost only

`ProjectionStore.ts:5394-5404,5484-5493` still reads run ordinals and per-run item counts for all shell threads, even where no shell row forks from them. The upstream c138163c8 patch limits those reads to fork source IDs and groups per-run counts before joining runs. Current ShellStream has batch coalescing/enrichment dedupe but lacks `skipUnchangedThreadShells`; upstream suppresses repeated unchanged live shells (apart from updatedAt) for at most five seconds, preserving catch-up cursor progress.

The code difference is high confidence; no large-database timing/allocation benchmark was run, so no numeric performance claim. The same upstream commit contains Codex streaming-text and MCP wait improvements handled by other audit domains; no claim those are entirely absent here. Adapt the shell/projection portion independently and retain existing authoritative ordering.

### Dependency foundation compatibility

The parent/workspace audit separately reproduced declared MCP failureMode:return yielding isError:false on installed Effect rc115. dff412c34 is a tests-only commit, so it is not by itself the owning product repair. Assess installed Effect behavior/upgrade compatibility rather than counting test commits as implementation. This report does not duplicate that reproduction.

### Extra repro commands and outcomes

- `node /private/tmp/testrig-runtime-rpc-repro.mjs` → sibling stream ends; `AUDIT_DISABLE_FATAL=true node ...` → sibling delivers second value.
- `node /private/tmp/testrig-runtime-sqlite-repro.mjs` → external commit lands, production transaction write fails UnknownError/database locked.
- `node /private/tmp/testrig-runtime-busy-stream-repro.mjs` → writer remains pending after stream close.
- `node_modules/.bin/vp test run apps/server/src/orchestration-v2/AuditDelegatedRecovery.tmp.test.ts` → 1 failed, app-owned tasks wrongly cancelled.
- `node_modules/.bin/vp test run apps/server/src/orchestration-v2/AuditAgentHistory.tmp.test.ts` → 1 failed,91 vs75 page rows.

Both failing audit test files were archived under /private/tmp and removed from the checkout. They are deliberately expected-upstream-behavior reproductions, not committed failing tests. Existing170 + selected9 + observed-stop1 checks passed; added2 upstream regressions failed as recorded.
