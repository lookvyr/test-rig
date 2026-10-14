# PR watch follow-up intake — October 14, 2026

Compared T3 Code nightly `v0.0.46-nightly.20261013.3053` (`6524a8d4`) with
`v0.0.46-nightly.20261014.3118` (`7ac952c6`). The core watch evaluator, wake
instructions, polling cadence, and stop conditions are unchanged between those
releases. This intake adapts the surrounding fixes to Test Rig's existing
transport, provider runtimes, and persisted history.

| Upstream source                                                                                                    | Adaptation                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#19162](https://github.com/pingdotgg/t3code/pull/19162)                                                           | Serialize workflow/check pairs so distinct CI checks cannot overwrite a failure through an ambiguous identity. Reruns still replace only their own pair.                                                                                                                    |
| [#19423](https://github.com/pingdotgg/t3code/pull/19423)                                                           | Count notification-started runs toward the bounded history window. Indexed SQL probes and the memory implementation agree; notifications steering an existing turn do not add another turn. Older history remains pageable.                                                 |
| [#19099](https://github.com/pingdotgg/t3code/pull/19099)                                                           | Allow snoozing with automatic notifications or delegated completions queued. Queued human work still blocks snooze. Stop/recovery discard provider-buffered wake placeholders whose output died with the process, while retaining durable server notifications.             |
| [#19344](https://github.com/pingdotgg/t3code/pull/19344), [#19374](https://github.com/pingdotgg/t3code/pull/19374) | Freeze merged-PR server cache epochs across ordinary turns and stop the linked-PR client's automatic refreshes once merged. Explicit refresh remains available; cache scopes retain project and credential isolation.                                                       |
| [#19248](https://github.com/pingdotgg/t3code/pull/19248)                                                           | Persist a single changed PR link for background sync instead of copying the entire thread. Server and client projections, replay, sync, and settlement consume the new event; historical full-thread events remain supported.                                               |
| [#19368](https://github.com/pingdotgg/t3code/pull/19368)                                                           | Give Codex MCP startup a ten-second grace window before its first model request. Existing plan-tool and authentication overrides remain intact.                                                                                                                             |
| [#19355](https://github.com/pingdotgg/t3code/pull/19355)                                                           | Harden Test Rig's existing native-task release cleanup with task ownership snapshots and atomic provider-row comparisons. Replacement tasks survive. Process-owned work is cleaned up for Claude and Codex; OpenCode work on its shared server can outlive session release. |

## Preserved boundaries

Test Rig's approval/merge-readiness notifications, richer GitHub fingerprints,
comment pagination, and credentials remain in place. Durable app-owned PR
watches come from thread links and are separate from native provider task
rosters. Session cleanup does not end those watches. The broad updater/restart
changes in #19291 and upstream's source-control package reorganization are not
part of this intake.

## Verification

Focused backend, provider replay, client-runtime, projection, and watch-control
tests passed, together with scoped contracts, shared, client-runtime, server,
web, and desktop typechecks. Coverage includes check identity and reruns, cache
credential isolation and explicit refreshes, compact-event replay/compaction,
queued automatic versus human work, full history pagination, native task
ownership, and atomic release writes. Native replacement and concurrent-write
regressions use Deferred synchronization rather than timing sleeps.

Browser verification reused an isolated development home and the real Codex
provider. It watched the existing upstream PR #19669 without modifying the PR,
received a failed-check notification, and retained the watch across both turns.
Snooze and Wake preserved monitoring. Stop watching removed the monitor while
keeping the PR linked. Read-only database inspection confirmed the compact
single-link sync payloads and the final watch state. The test watch was stopped
after verification; the isolated app remains available.

Independent review covered correctness and simplification. It found an initial
release-record ownership check that could race a replacement open; the check
and write now share the session-open lock. The existing attachment-failure
cleanup reuses its held lock, and focused regressions cover both interleavings.
The full repository suite and packaged Windows/Linux apps were not exercised.
