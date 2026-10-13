# PR watch hardening intake — October 13, 2026

Compared `codex/tools-library` at `35d19fc4` with T3 Code nightly
`v0.0.46-nightly.20261013.3053` (`6524a8d43795dc543f7cfb572388cdea3662ad48`).
The upstream implementations are adapted to Test Rig's existing API transport and
orchestration, without importing the later source-control package reorganization.

| Upstream source                                          | Port                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#16208](https://github.com/pingdotgg/t3code/pull/16208) | Two-minute sweeps, one read per PR/project, quiet-read gating, independent updates for each watching thread, eight failed reads before stopping, rate limits excluded, closure notifications, and restarting from stale closed snapshots. Settle/archive ends watches; subagents cannot start them. Advisory checks appearing already passed do not generate repeated passing notifications. |
| [#16270](https://github.com/pingdotgg/t3code/pull/16270) | Batched GitHub fingerprints gate detail/activity reads, with 30-minute activity refreshes and 10-minute quiet refreshes on hosts without fingerprints. Fresh reads invalidate older cached detail/activity. New watches and incomplete or refused updates retry without waiting for the quiet interval.                                                                                      |
| [#16262](https://github.com/pingdotgg/t3code/pull/16262) | Local watch-end diagnostics record reason, reads, wakes, and time without a push.                                                                                                                                                                                                                                                                                                            |
| [#16204](https://github.com/pingdotgg/t3code/pull/16204) | Watches appear as pending monitors and keep threads in Working between wakes, including threads without a run. Stop can end a watch without an active run. Tool instructions tell the agent to unwatch when handing work back.                                                                                                                                                               |
| [#17635](https://github.com/pingdotgg/t3code/pull/17635) | A named monitor displays “Watching pull request …” without a redundant prefix.                                                                                                                                                                                                                                                                                                               |

## Preserved behavior

- **Test Rig's approval and merge-readiness extension** (`ed788b4c`, `82e37e6e`):
  initial review baselines, actual decision changes, confirmation on new commits,
  unavailable decisions, and distinct blocked/unknown/ready/queue-required/queued
  states. Notifications still identify the head and require checking current
  requirements before an authorized merge. The fingerprint additionally includes
  `reviewDecision`, `isDraft`, `mergeStateStatus`, and GitHub.com's merge-queue
  fields; unknown readiness continues detail polling. Older Enterprise schemas
  are not asked for merge-queue fields.
- **Existing comment-read correctness:** pagination deduplicates reply IDs,
  validates completeness, rejects cursor cycles, and rereads reply tails whenever
  activity is refreshed. Upstream's count-only tail cache is not adopted: it would
  miss edits to existing replies even during periodic full reads. Quiet GitHub
  tail edits may wait for the 30-minute activity refresh, as upstream documents.
- **Existing boundaries:** local API transport, credential-scoped batching/cache
  keys, host rate-limit reset handling, disabled-provider gates, historical watch
  decoding, and Test Rig's single-PR association resolution remain in place.

The former settle-to-pause policy is **replaced**, as requested when prioritizing
upstream behavior over fork-specific watch behavior. Settling and archiving end
watches atomically; restore does not restart them. Late wakes cannot revive them.
`FORK.md`, user documentation, and the shared web/desktop renderer reflect this.

## Already present or outside this intake

Edited-comment detection (#15415), paginated replies (#15427), required checks
first observed as passed (#15804), duplicate running checks (#17344), cascading
Stop (#16002), and skipping sync polls for settled threads (#16762) were already
present. Their relevant behavior remains covered by the focused tests.

Generic MCP target/access refactoring and guided reviews are separate features,
not required for PR-watch hardening. Mobile, cloud, and additional hosting-provider
changes remain outside this fork's product scope.

## Verification

Validation passed: 632 tests across 17 focused files, plus three targeted runtime
integration cases. Coverage includes the watch evaluator/reactor, API fingerprints
and provider service, MCP handlers, persisted watch lifecycle and stale-wake races,
projection and settlement monitors, client presentation/Stop, and renderer controls.
Changed-file lint and formatting passed; lint reports existing unused-variable
warnings. Scoped server, shared, client-runtime, and web type checks passed.
The repository-wide suite was not run.

### Live verification

Booted the web app in an isolated home and drove Chromium against the real Codex
CLI and disposable [PR #7](https://github.com/lookvyr/test-rig/pull/7). Refreshed the
expired Codex login through device authorization. Verified:

- Codex starts a watch through its built-in tool; the completed turn leaves a
  background monitor and a usable Stop control.
- A draft PR is blocked even when GitHub reports `CLEAN`. Draft-to-ready and
  ready-to-draft transitions update merge readiness and produce notifications;
  the ready notification identifies the unchanged head commit.
- The generated fingerprint query and decoder work against GitHub's live schema.
  Live tracing exposed a missing capability in the provider settings wrapper:
  the wrapper now forwards and gates fingerprints. Repeating the readiness wake
  after the fix confirms that activity is not reread for a status-only change.
- Stop clears the watch without unlinking the PR. Settlement clears it, and
  restoring the thread does not restart it.
- Closing the PR produces a “closed, stopped watching” notification and removes
  the persisted watch on the next normal sweep. PR #7 was closed without merging.

After the wrapper fix, 321 tests across the registry, service, CLI, and reactor
passed, along with server type checking and changed-file lint/format checks. The
registry regression test verifies forwarding while enabled, rejection while
disabled, and recovery when re-enabled.

Live check-status mutations were unavailable: the GitHub integration returned
HTTP 403 for commit-status creation. Check transitions, approval decisions,
merge-queue states, rate limits, and read failures retain automated coverage;
they were not all exercised against GitHub in this session.
