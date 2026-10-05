# V2 port follow-up audit

October 4, 2026, against `e0b8d06f21a9ffe7a01494fb188ab0d71125ea7f` on `codex/orchestration-v2`. That commit contains the completed [fork-preservation repairs](orchestration-v2-preservation-audit.md). This pass audits the broader imported feature work and remaining acceptance in LOO-23–47. Four GPT-6.1 Sol domain audits, primary-agent verification and a separate GPT-6.1 Sol challenge review inform this record.

The original audit pass made no production changes, application servers, live provider turns, external writes or pushes. Temporary reproduction tests were removed from the checkout. Subsequent authorized steering and MCP cancellation repairs are recorded below; Linear was reconciled with their verified scope. Source findings, reproduced behavior, missing implementation and unverified behavior are distinguished below.

## Findings requiring implementation or a narrow behavior decision

### Interactive queue UI superseded by steering-only follow-ups — LOO-23

The backend durably holds queued runs after Stop or restart. `ProviderRuntimeRecoveryService.ts` sets `queueHeld`; `Orchestrator.startNextQueuedRun` respects it. The shared client exposes resume/edit/reorder/cancel/promote commands in [threadCommands.ts](../../packages/client-runtime/src/state/threadCommands.ts), but neither web nor desktop calls them. The renderer also excludes undispatched queued-turn messages from its ordinary timeline in [session-logic.ts](../../apps/web/src/session-logic.ts).

Consequently, a held queue can survive correctly in storage while the user has no ordinary UI to inspect or resume it. Sending a new immediate prompt does not release those saved runs. The original audit identified this as an incomplete queue UI. The subsequent product decision supersedes that recommendation: interactive follow-ups are steering-only, with Send disabled until steering is available and drafts retained. Internal deferred work and historical queue records remain intact. A user-facing queue editor/resume flow is outside the chosen scope.

### Stop at a completion boundary can leave the remaining queue unheld — LOO-23/24

The client sends a run-specific `run.interrupt` with `holdQueue: true` in [commands.ts](../../packages/client-runtime/src/operations/commands.ts). If A completes and queued B is promoted before Stop(A) reaches [Orchestrator.ts](../../apps/server/src/orchestration-v2/Orchestrator.ts), the command rejects because A is no longer interruptible. The queue hold is never applied.

A deterministic reproduction against the actual runtime TestLayer created A, B and C, completed A, synchronously promoted B, then dispatched Stop(A). It observed a failure, B still starting, and C still queued without a hold. No timing sleeps were used.

Holding remaining queued work and interrupting B are separate choices. Refusing to retarget newer work may be intentional; the existing queue-hold expectation still needs an explicit stale-Stop rule. The smallest repair should preserve run ownership and define whether a late Stop holds C even when A has settled. Do not silently interpret this finding as permission to interrupt unrelated newer input.

### Native Codex MCP approval cancellation repaired — LOO-45

The original MCP elicitation handler in [CodexAdapterV2.ts](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) stored an approval without its native JSON-RPC request identity. The `serverRequest/resolved` handler only correlated `user_input` entries, so it could not remove or cancel the MCP approval.

A disposable replay issued a supported MCP elicitation, emitted its matching native resolution, then attempted a late answer after a protocol response barrier. The approval statuses remained `[pending]` and the late accept returned success; the expected cancellation assertion failed. This confirmed the adapter lifecycle defect without claiming a live connector test.

The authorized repair now retains native RPC/thread identity, cancels the pending request/node/item on matching resolution, and rejects late decisions. Native-child approvals remain owned by the parent application thread. The permanent replay covers root/child cancellation, mismatched identities, duplicate resolution and late responses; normal accept and persistent accept remain intact. Full adapter/helper verification passed 142 tests, and three focused session-release checks passed. Existing shared session cleanup terminalizes pending requests on release. This is deterministic protocol and lifecycle evidence; no live connector smoke test is claimed.

### Pending attachment ownership repaired — LOO-35

The original MCP discard handler checked an active caller but deleted by global pending attachment ID without ownership. An authenticated caller possessing another pending ID could discard it; the audit did not establish arbitrary ID discovery, delivered-asset deletion, unauthenticated access or observed data loss.

The authorized repair records the issuing application thread in a durable sidecar before returning the upload URL. MCP discard, attachment send and prepared thread launch check that source ownership before deleting or claiming files. Owners can transfer to permitted targets; ordinary composer uploads retain their separate thread-owned path. Immutable ownership survives provider/server restarts and stays with the pending retry source. Repeated owner discard stays harmless; the existing 24-hour sweep removes abandoned owner records. Missing or malformed owner records fail closed for MCP consumers.

Browser verification additionally reproduced a 404 when posting to the signed URL: the existing upload handler was never registered as an HTTP route. The registered POST route now verifies the signed token and streams through the existing size-checked persistence path. An HTTP regression test covers invalid tokens, short/oversized payloads, successful upload and partial-file cleanup.

Verification: 46 focused tests passed across upload HTTP, attachment storage/claims/intake, MCP attachment/project handlers and HTTP routing; server typecheck passed; targeted lint passed with two pre-existing unused-import warnings. Independent GPT-6.1 Sol review found no actionable defect or worthwhile simplification in either ownership or route registration. In the browser, a pasted image reached Codex, signed upload returned 204 after a server restart, another chat's discard returned invalid_request without deleting the bytes, and the source chat successfully sent the attachment then discarded the original. The recipient read TEST from its delivered copy; filesystem inspection confirmed the original was absent and delivered bytes remained.

The subsequent project/launch/integration pass completed LOO-35 acceptance. It found a setup-completion bypass: root and existing-worktree launches did not request a completion observer, so synchronous setup could release the provider before its result was known. All workspace strategies now request completion; explicit asynchronous setup retains its existing behavior. Deferred-driven tests prove that a failed setup leaves the original message, intended binding and error intact, does not release provider execution, and rejects a stale release request.

Real disposable Git repositories retain their metadata/index and tracked, untracked and ignored sentinel files after empty or forced nonempty project deletion and retries. Nonempty deletion without force rejects. MCP preference filtering and saved-settings normalization preserve excluded settings; disabled GitLab, Azure DevOps and Bitbucket operations, discovery and clone prerequisites retain their gates. Generic Git remains available. These are scoped service/contract checks, not a universal network audit.

Live browser/Codex verification registered a disposable project with synchronous setup exit 17 and launched it at the project root. The UI retained its prompt and displayed the setup error; the provider projection remained not_loaded with no native thread reference. Deleting the nonempty test project first refused, then succeeded with force; its repository and all three sentinel hashes remained unchanged. An Auto caller's project mutation was denied, and an existing full-access test caller exercised the authorized path. Cross-project thread read/wait stayed scoped and refused the caller; the primary tester inspected the new thread through the UI and durable state.

Focused verification included 48 launch/setup tests, 17 project-service tests and 34 integration-boundary checks. Independent GPT-6.1 Sol review found no actionable defect or worthwhile simplification. These follow-up changes build on the attachment repair in `9e7c4d81`.

### Reopened compaction continuity and honest status labels — LOO-26

A live reopened Codex session compacted before any ordinary turn populated the adapter's app-context cache. Its native compacted history contained no app instruction blocks, but the next ordinary turn restored all three applicable developer blocks (orchestration, runtime and tools) before the user message. The conversation continued with its earlier facts intact. This disproves the proposed instruction-loss defect on the tested Codex 0.160.0 path; no additional restoration mechanism was added. A permanent replay verifies resume, compact, then full additionalContext on continuation with distinct terminal events.

The probe exposed a separate presentation defect: a server restart interrupted the first compaction, and native/durable state correctly recorded cancellation, but the shared work-log label said Context compacted. The shared helper now distinguishes active, failed, stopped and completed states; both renderer paths use it. Browser verification displays the interrupted and successful compactions with their correct distinct labels. The native compaction path itself was unchanged.

Live Claude and OpenCode conversations also compacted and then recalled their original test tokens. Claude's native compact boundary recorded context shrinking from 40,699 to 3,787 tokens; its adapter supplies app instructions through the resumed SDK query's systemPrompt.append (the diagnostic log intentionally omits that content). OpenCode's native store retained the active test_rig instruction entry with runtime and delegation instructions after compaction and continuation. Codex native developer entries, Claude SDK-option tests/source and OpenCode's persistent entry provide instruction-delivery evidence distinct from the model's recall of a user token.

Three selected compaction/background replays passed: Claude compact after a resumed background wake, Claude peer-turn compaction without echoed user input, and OpenCode compact then continue. The OpenCode replay initially timed out because its expected instruction-entry key was still t3-code; updating that one fixture expectation to test_rig made it pass. Existing focused adapter tests cover watermark versus billed usage and terminal/input ordering. The shared label/rendering verification passed 264 tests. Server, web and client-runtime package typechecks passed, with targeted lint/format checks and independent review. These scoped acceptance checks complete LOO-26; they do not claim every provider/background interleaving or introspection into model-hidden prompts.

## Remaining feature delivery

| Owner  | Current result                                                                                                  | Smallest remaining work                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOO-23 | Approved steering-only main/side composer flow implemented; internal queues retained.                           | Complete for the chosen scope, with live Codex proof. Claude/OpenCode live steering remains unverified in this pass.                                    |
| LOO-24 | Restart/late-event guards exist; stale Stop behavior above is reproduced.                                       | Define the completion-boundary rule; finish scoped public Stop/stale-session and native lifecycle acceptance.                                           |
| LOO-26 | Live compact/continue verified for retained providers; stopped/failed labels repaired.                          | Complete for scoped context, watermark and resume/background acceptance; no Codex instruction-loss defect reproduced.                                   |
| LOO-27 | Context handoff and native-identity coverage are implemented; no additional causal defect established.          | Live cross-provider switch/back, failed injection and long-history retrieval acceptance.                                                                |
| LOO-29 | Native child send rejection and parent request ownership are present.                                           | Missing/archived parent and large-history edge acceptance; retain previous child/restart proof.                                                         |
| LOO-30 | Delegation/cohort delivery and repeated acknowledgement/disposal tests pass.                                    | Resolve LOO-15 workspace/context defaults, then scoped app-owned provider/restart/nesting acceptance.                                                   |
| LOO-31 | Scoped reading and same-project messaging exist.                                                                | Explicit side-to-main accepted-delivery/disposal semantics and busy-target/retry acceptance.                                                            |
| LOO-32 | Rich composer supports files/skills; conversation-reference chips and sidebar drag payloads are absent.         | Wire thread references into rich drafts, scoped retrieval and persistence.                                                                              |
| LOO-33 | Durable schedules and MCP controls exist; Settings management UI is absent.                                     | Resolve LOO-14 and complete the shared management surface and saved-launch-setting acceptance.                                                          |
| LOO-34 | Backend recovery guards and independent snooze/auto-resume fields exist, default off.                           | Expose opt-in settings and per-thread recovery controls; preserve manual continuation without a trustworthy reset time.                                 |
| LOO-35 | Attachment ownership/route repaired; setup failure, repository preservation and integration gates verified.     | Complete for scoped project/attachment/settings acceptance, including live Codex project launch/deletion.                                               |
| LOO-36 | Initial handoff guards passed 50 tests; October 5 live acceptance and session-detach repair are recorded below. | Completed for Codex, Claude and OpenCode, with background setup explicitly chosen. OpenCode replay timeout remains a validation limitation.             |
| LOO-39 | Unchanged bootstrap reads allocate new arrays every two seconds.                                                | Compare successful snapshots before setting React state; preserve empty-result clearing and failure retention. No reconnect/refetch defect established. |
| LOO-42 | Mounted palette rows obtain VCS/PR queries without visibility bounds.                                           | Visible-row query leases retaining cached display and hosting gates. No live subprocess/request count measured.                                         |
| LOO-43 | Server naming modes exist; Settings only exposes the retained worktree prefix.                                  | Expose naming modes/instructions and prove precedence/collisions. Configured-prefix and delayed-label repairs are already committed.                    |
| LOO-45 | Native MCP approval cancellation repaired with permanent root/child and normal-response replays.                | Complete for the supported approval lifecycle; no live connector smoke test claimed.                                                                    |
| LOO-46 | Cross-directory ledger entries are rejected before process signaling; six native ownership tests pass.          | Dedicated copied-state proof showing the original tracked process remains alive. No destructive cleanup defect established.                             |
| LOO-47 | Imported details components exist alongside retained panel behavior.                                            | Live resize/drag/occlusion/persistence acceptance. No source-only layout defect established.                                                            |

The naming controls live in [SettingsPanels.tsx](../../apps/web/src/components/settings/SettingsPanels.tsx), with the imported fields in [settings.ts](../../packages/contracts/src/settings.ts) and [ThreadLaunchService.ts](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts). Palette query wiring is in [CommandPalette.tsx](../../apps/web/src/components/CommandPalette.tsx) and [ThreadStatusIndicators.tsx](../../apps/web/src/components/ThreadStatusIndicators.tsx). Bootstrap identity behavior is in [useDesktopLocalBootstraps.ts](../../apps/web/src/connection/useDesktopLocalBootstraps.ts) and [desktopLocal.ts](../../apps/web/src/connection/desktopLocal.ts).

## Behavior and policy limits

- **Reopened Codex compaction:** the adapter cache is initially empty and immediate compaction skips cached reinjection. The live probe showed all applicable app blocks restored on the following ordinary turn before the user prompt. The earlier suspected loss is disproved on this tested native path; no additional restoration mechanism was added.
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

1. Native MCP elicitation cancellation (LOO-45) is repaired with permanent regression coverage.
2. Define and verify the stale-Stop rule for internal deferred work (LOO-24). The approved steering-only composer flow (LOO-23) is implemented; do not add a user-facing queue editor.
3. Compaction acceptance (LOO-26) is complete; finish cross-provider switching/continuation (LOO-27) before expanding collaboration features.
4. Project/launch acceptance (LOO-35) is complete. Expose the remaining controls, with policy decisions for scheduling/delegation made before accepting those flows.

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

## Internal reliability follow-up — October 5, 2026 (UTC)

The user approved LOO-39, LOO-46, LOO-29, LOO-42 and the scoped LOO-24
Stop/recovery work. Changes were independently reviewed, corrected where needed,
and committed on `codex/orchestration-v2`. The user subsequently authorized
pushing the reviewed branch. Commit email metadata uses the GitHub no-reply address.

- **LOO-39 — `66fbeced`:** unchanged desktop bootstrap results retain their array
  identity. Real changes, clearing and failed-read retention remain covered.
  Desktop/platform tests: 24 passed; web typecheck passed. No native desktop
  session was available in this cloud environment.
- **LOO-46 — `a8e7619e`:** a copied ledger is reaped twice without signaling the
  original process group or changing its original ledger. The original owner
  then cleans up that group. Ledger/owner tests: 19 passed. A child-subreaper
  wrapper was necessary because cloud PID 1 does not reap orphaned test children.
  Darwin observation flags were exercised on Linux; this is not native macOS proof.
- **LOO-29 — `b893533e`:** missing/archived parent history windows page through
  251 child artifacts without loss or duplication; replayed native children reject
  direct messages after parent archive/deletion. Six history/projection tests and
  the selected Claude replay test passed. A real Codex child opened read-only in
  the browser, and Open parent restored the parent composer. The full Claude
  replay file still has an unrelated missing `thread_fork_native_continue`
  transcript; only the relevant selected replay is claimed here.
- **LOO-42 — `b5b76529`:** nearby rows lease VCS/explicit-PR queries and retain
  cached badges offscreen, keyed to query identity. Integration opt-outs remain
  enforced. Review caught the VCS atom's five-minute idle lifetime; status streams
  now close when their last subscriber leaves, while shared active consumers keep
  them alive. Component/registry/VCS tests: 32 passed; web and client-runtime
  typechecks passed. Browser palette rows rendered correctly. Thirty-row visibility
  and subscription counts were tested automatically, not measured as production
  subprocess savings or a large browser scrolling benchmark.
- **LOO-24 — `94bb0441`:** archive reads only unfinished command items, avoiding
  irrelevant completed-output decoding. Active preparation is interrupted and
  completed preparation is preserved. The existing malformed-history control
  regression now passes. New tests lock run ownership for stale Stop and public
  service scope; existing recovery/continuation/provider tests were exercised.

The approved Stop rule follows upstream run ownership: once A completes and B
starts, browser Stop(A, holdQueue=true) rejects without touching B or holding C.
C can still start after B completes. The MCP `interruptThread` service separately
returns `already_terminal` for an explicit completed run. These are distinct
entry-point responses; no new silent-success or retroactive-hold UX was added.

LOO-24 focused verification: runtime Stop/queue selection 4 passed; public Stop
and control reads 21; archive 6; recovery/restart continuation/replay 29;
provider-event ingestion/restart notes/delegated delivery 21; selected Codex/Claude
interrupt and stale-event cases 35; selected execution ownership cases 17.
Server typecheck passed. Focused lint had only existing unused declarations in
Orchestrator.ts. No repository-wide checks were run.

Live Codex 0.159.0-alpha.3 browser checks exercised a real command interrupted by
Stop, a successful follow-up (`STOP_RECOVERY_OK`), and persistence across reload.
A separate accepted turn was interrupted by a controlled watched-backend restart;
the browser reconnected without a stuck running state and another prompt answered
`RESTART_RECOVERY_OK`. This is graceful server replacement, not crash injection.
Claude/OpenCode native live recovery and native desktop parity were not re-run.
Test Rig and upstream nightly `v0.0.46-nightly.20261004.2657` remain in separate
isolated development state directories. No user's live application data was used.

The Linear recheck found no additional complete issue in the same decision-free
bucket. Scheduling/delegation policy and user-facing controls remain deferred.
A separable test-only repair switches ScheduledTaskService.test.ts from legacy
SQLite to V2 persistence: all three tests previously failed on a missing
`scheduled_tasks` table, then passed with the production schema. This does not
complete LOO-33 or choose scheduling behavior.

## October 5 — LOO-27 provider-switch acceptance

Ordinary conversations now allow provider/model selection after the first turn.
Selection updates the composer only. Send supplies the chosen selection with the
message; during an active turn, orchestration interrupts and restarts with that
selection and conversation context. This matches the installed upstream nightly
`0.0.46-nightly.20261004.2648`, verified against its picker and packaged client/server
implementation. The fork's steering-readiness rule still applies. Side chats keep
their provider lock, and native child conversations remain read-only.

Live acceptance uncovered a second legacy behavior: the pre-send settings hook
persisted model selection separately, releasing the running provider session
before the steering command arrived. That produced “No running provider turn
found” and restored the unsent draft. Model selection now belongs solely to the
message dispatch, including plan follow-ups and side-chat sends. Branch, runtime
mode, and interaction mode still persist through their existing paths. No server
guard or provider adapter was relaxed.

Verification in an isolated macOS browser environment:

- Codex → Claude → Codex → OpenCode → Claude → OpenCode retained the original
  three facts and additional tokens introduced at each handoff.
- All three providers reused their original native conversation IDs on return.
  Saved delivery records contained no duplicate item IDs for any target native
  conversation; idle switch-back handoffs covered only intervening runs.
- During a real Codex `sleep 90` command, choosing Claude left Codex running.
  After the pre-send fix, Send restarted the same app run with a second attempt
  on Claude, which returned all facts and the requested success marker.
- A graceful stop/restart of the isolated server preserved the conversation.
  Switching back to OpenCode resumed its original native conversation, delivered
  the intervening context, and recalled the active-switch success marker.
- OpenCode live checks used the installed Homebrew CLI 2.0.22. The other installed
  binary had an invalid signature and exited before startup; only the isolated
  test environment's provider path was changed.

Focused automated checks passed:

- ContextHandoffBudget, ContextHandoffService, ProviderTurnStartService: 37 tests,
  covering intact-item budgets, context-limit changes, current-input reservation,
  injection failure/ambiguous delivery, and fresh-session recovery.
- ProviderSwitchService and ProviderSwitch integration: 72 tests.
- A new MCP history test stores 43 real SQLite projection items, omits an oversized
  multilingual message from a handoff, and recovers it exactly through item and
  text-offset pagination: 1 test.
- ChatView logic, provider instance selection, the pre-send settings regression,
  and SelectionRestart integration: 101 tests.
- Web and server typechecks passed. Targeted lint reported existing warnings;
  formatting and diff checks passed. No repository-wide checks ran.

A separate agent reviewed correctness and simplification, identified the pre-send
ordering defect during live acceptance, and approved the final fix without further
findings. Failure injection and budget changes were verified with deterministic
adapters, not forced failures of live external providers. This pass exercised the
shared web renderer; Electron shell behavior and remote transport were unchanged
and were not separately smoke-tested. Settings/default-model selection and other
entry points keep their existing behavior. No commit, push, or PR is implied.

## October 5 — LOO-36 active worktree handoff

Live Claude acceptance exposed an exclusive-session detach defect: releasing the
old runtime closed its event stream as an error, failed the interrupted run, and
held the queued continuation. Detach now interrupts the active turn and preserves
its terminal event before closing subscribers. It subscribes before reading the
projection, treats a runtime as idle only after publishing its terminal event,
and checks runtime identity before removing or releasing an entry. A delayed
detach therefore cannot release a replacement runtime.

The explicit product decision keeps the installed nightly's simpler setup order:
bind the worktree, queue the requested continuation, then launch project setup in
the background. Moving does not wait for a synchronous setup result. Setup launch
failure reports the completed binding without rolling it back. This supersedes
the original proposal to finish all setup before binding; new-chat setup retains
its existing synchronous behavior. Saved project-specific script overrides take
precedence over environment defaults and inline project scripts.

Live browser acceptance used disposable Git repositories and isolated app state:

- Codex, Claude and OpenCode each moved an active conversation to the requested
  branch and worktree, automatically continued, recalled the original facts, and
  verified the working directory and project setup marker. The script was saved
  through the project's action editor with automatic worktree creation enabled.
- All three retained Auto permissions. An OpenCode shell approval was presented
  and accepted through the normal UI. No permission bypass was added.
- Durable state contained one MCP continuation per successful move. Repeating
  the Codex handoff returned `already_in_worktree`, with no duplicate branch,
  directory or continuation. OpenCode also consumed its native background wake;
  that completed without a second assistant response.
- The final Claude pass ran after both review-driven race repairs and finished
  with an interrupted original run and completed continuation, without a held
  queue. Setup markers contained the requested new worktree directory.

Focused verification passed 108 tests: ProviderSessionManager (48),
WorktreeMcpService (50), ProjectSetupScriptRunner (1), and SelectionRestart (9).
The new deterministic cases cover delayed terminal delivery, a terminalizing
projection, and runtime replacement during detach. Existing handoff cases cover
owned-resource rollback, interrupted binding, concurrent requests, capability
denial, base/origin selection and post-bind failure. Setup coverage now verifies
saved project override precedence in the new working directory. Server typecheck,
targeted lint and diff checks passed; the two setup/handoff test files retain
pre-existing unused-variable lint warnings. No repository-wide checks ran.

The additional OpenCode worktree replay timed out at 60 seconds. Replacing only
ProviderSessionManager with the unchanged HEAD source in a temporary test config
also timed out under a 10-second diagnostic limit. That replay is not claimed as
passing; the real OpenCode browser move supplies the acceptance evidence here.
A separate correctness and simplification review approved the final source and
tests with no remaining findings. The shared renderer and server path were
exercised; no Electron-shell or remote-transport changes were made or separately
smoke-tested.

A subsequent recorded Claude demo again retained the original codename, moved to
the requested branch, and verified setup output. Setup's dedicated terminal is
available from the thread's terminal drawer; the handoff does not publish a
separate setup-completion indicator. The expected handoff interruption still
appears as a failed tool call / "interrupted by user" in the timeline. These
misleading labels are a remaining presentation follow-up, not a failed move.

## October 5 — LOO-31 requested chat coordination

Temporary Codex and Claude side chats can send requested findings to their parent
or another chat in the same project without being kept or promoted. Provider and
tool instructions require explicit user intent; reading a reference or receiving
another agent's request does not grant messaging authority. OpenCode's managed
runtime exposes ordinary orchestration MCP tools, but native `/side` remains
limited to Codex and Claude. This change does not add OpenCode side chats.

The existing MCP delivery policy is retained: `auto` starts idle work, steers a
fully active turn, and queues behind work that is not yet steerable. Explicit
queue, steer and restart modes remain available. Interactive composer follow-ups
remain steering-only. The send result acknowledges durable acceptance through
message ID, run ID and delivery; the run status can advance between retries.

Accepted steer/restart retries previously failed once the target stopped being
steerable. Thread management now reads the existing command result before those
transient checks, using the same receipt validation as normal dispatch. Reusing
a key for another target still fails. New sends still require a suitable target.
Send and interrupt share active-caller/provider ownership checks and permission
ceilings. Deleted side callers cannot start new mutations. User-attached
cross-project references remain readable without gaining send/interrupt access.

Idempotency keys are scoped to the issuing provider credential. Retry an identical
request with its original key while that credential remains valid. Batches can
partially succeed: retrying the same ordered batch with the same key recovers
accepted entries without starting another continuation. After changing sessions,
inspect existing threads before creating replacements. Tool descriptions now
state these limits.

Verification passed 60 focused tests across SideChat, ThreadManagementService,
OrchestratorMcpService, paged MCP history, tool guidance, orchestration control
reads and receipt migration checks. Real SQLite/event/receipt tests cover:

- Side-to-idle-parent, busy-parent and peer sends; duplicate acknowledgement;
  accepted messages surviving discard; stale callers rejected afterward.
- Auto/steer/restart into active work; identical retries after completion; fresh
  idle steer/restart rejection; cross-target key conflicts.
- Capability, caller provider, inactive/archive, permission, project and native
  child boundaries. A user-attached cross-project thread is readable but cannot
  receive sends or interrupts.
- Partial batch failure and retry with no repeated first task/continuation.
- Existing history paging reconstructs a long multilingual item across offsets.

Live browser acceptance used the retained isolated environment at
`/tmp/test-rig-loo27.VFXMTW`, with a fresh parent and native side chat for each of
Claude Sonnet 5 and Codex GPT-6.1-Sol. Each side sent through MCP, retried the same
key, and returned matching message/run IDs. The Claude retry observed the target
advance from starting to completed. Both parent replies remained after their side
chats were discarded. Read-only database checks found exactly one sent message
and one accepted send receipt per parent, with both side threads deleted.
Screenshots are retained in that environment as `loo31-side-receipt.png`,
`loo31-parent-after-discard.png`, `loo31-codex-side-receipt.png`, and
`loo31-codex-parent-after-discard.png`.

A separate correctness/simplification pass consolidated send/interrupt guards
and retained shared receipt handling. Targeted lint and diff checks passed, with
three existing unused-variable warnings in Orchestrator. Server typecheck has no
errors in changed files, but remains blocked by the existing untagged `Error` in
ProviderSessionManager.ts:2071. That line is unchanged from HEAD. No repository-wide
checks ran. The shared web/desktop renderer and server path were exercised; no
Electron shell, remote transport, Settings, command-palette or keybinding changes
were required. The `/side` entry point and reverse Discard action were tested.

### Follow-up: natural-language target discovery

A fresh Codex GPT-6.1-Sol sender received: “Can you send this to the thread doing
performance work?” followed by a database batching finding and tracking marker
`PERF_SOFT_MATCH_31`. The target was titled “Backend performance optimizations.”
The sender was given no target ID, exact title, or tool instructions.

Without code changes, it called `t3_thread_list` with
`{"titleContains":"performance","limit":50}`, selected the matching target,
and called `t3_thread_send`. The target received the finding with the correct
sender attribution. This verifies agent-driven title discovery for a clear match;
it is not a dedicated semantic-search index or proof of ambiguous-title handling.
The sender and target screenshots are retained as `loo31-soft-match-sender.png`
and `loo31-soft-match-target.png` in the same isolated test directory.
