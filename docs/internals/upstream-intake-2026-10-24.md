# October 24 upstream reliability and performance intake

This batch selectively ports 19 changes from [T3 Code](https://github.com/pingdotgg/t3code)
into Test Rig. The implementations follow upstream behavior and adapt its file and
service boundaries to the retained Test Rig architecture. This is a focused intake,
not a merge of upstream main. Upstream code remains covered by the repository's MIT
license and attribution.

| Upstream                                                 | Ported behavior                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [#21882](https://github.com/pingdotgg/t3code/pull/21882) | Add environment and project thread-title instructions to new and regenerated titles for all retained providers.         |
| [#23776](https://github.com/pingdotgg/t3code/pull/23776) | Reuse a lazily initialized collator for changed-file tree sorting.                                                      |
| [#23783](https://github.com/pingdotgg/t3code/pull/23783) | Exclude child transcript-only events from the shell stream while retaining status, requests, and focused child history. |
| [#23814](https://github.com/pingdotgg/t3code/pull/23814) | Reconcile stale locally running commands after Stop and repair their persisted client cache.                            |
| [#23819](https://github.com/pingdotgg/t3code/pull/23819) | Resume terminal control-string scans at new data while preserving split terminators and stored history.                 |
| [#23840](https://github.com/pingdotgg/t3code/pull/23840) | Resume idle Codex parents when direct native children finish, preserving ownership and interruption guards.             |
| [#23852](https://github.com/pingdotgg/t3code/pull/23852) | Gate periodic PR discovery on the existing foreground/background activity policy.                                       |
| [#23863](https://github.com/pingdotgg/t3code/pull/23863) | Notify once when a GitHub head remains without checks after the grace period; preserve restart and rewatch state.       |
| [#23904](https://github.com/pingdotgg/t3code/pull/23904) | Remember pending advisory checks after required gates pass and notify once when the remaining checks succeed.           |
| [#23953](https://github.com/pingdotgg/t3code/pull/23953) | Skip unused Git line parsing when no progress callback consumes it; preserve output and caps.                           |
| [#23965](https://github.com/pingdotgg/t3code/pull/23965) | Locate native resource-monitor build output from source and bundled server layouts.                                     |
| [#23987](https://github.com/pingdotgg/t3code/pull/23987) | Use an ID-only active-subagent read when resuming the shell stream.                                                     |
| [#24022](https://github.com/pingdotgg/t3code/pull/24022) | Capture PDF pointer and keyboard input during native desktop annotation; start with Region.                             |
| [#24032](https://github.com/pingdotgg/t3code/pull/24032) | Hide subagents from palette thread results and prefer word-start and recent title matches; retain forks.                |
| [#24172](https://github.com/pingdotgg/t3code/pull/24172) | Allow a fork's first /compact when native or portable inherited history actually exists; cover SQLite and memory.       |
| [#24229](https://github.com/pingdotgg/t3code/pull/24229) | Refresh resource telemetry and the selected history window after a successful retry.                                    |
| [#24267](https://github.com/pingdotgg/t3code/pull/24267) | Coalesce superseded streaming text inside existing windows while retaining completion boundaries and cursors.           |
| [#24299](https://github.com/pingdotgg/t3code/pull/24299) | Preserve the interruption initiator and an agent's reason in the result row.                                            |
| [#24521](https://github.com/pingdotgg/t3code/pull/24521) | Apply HTML preview appearance to browser media mode before loading content and measuring height.                        |

The ports retain Test Rig's three-provider boundary, steering-only interactive
follow-ups, cascading Stop, parent-owned PR watches, and authenticated local
server. Provider-specific child wakeups remain in the Codex adapter; stream and
cache work uses the shared server/client runtime rather than adding a parallel
path. The resource-monitor fix retains Test Rig's independent runtime identity.
No migration or excluded product surface is introduced.

## Deferred

- [#24343](https://github.com/pingdotgg/t3code/pull/24343): indexed message search.
- [#23657](https://github.com/pingdotgg/t3code/pull/23657): Claude approval feedback.
- [#24334](https://github.com/pingdotgg/t3code/pull/24334): quieter automatic compaction.

These items are outside this batch and are not implied by the related palette,
interruption, or compaction changes.

## Verification status

Focused regression tests and scoped checks accompany the ports. Independent
reviews cover the implementation and integration; no aggregate test count is
asserted here.

The primary agent verified these behaviors in the running app:

- A real native Codex child finished after its parent and triggered one parent
  wake with the result; the child's transcript remained available.
- A fork successfully ran `/compact` as its first message.
- Normal Stop displayed the user interruption label, and the stopped status
  remained correct after reload.
- Thread-title defaults and project overrides persisted, reset correctly, and
  affected initial title generation.
- Palette action mode worked, forks remained discoverable, and subagents were
  excluded from thread results.
- Native desktop PDF annotation supported Region, Draw, comments, Attach, and
  normal scrolling after annotation. Attach creates an annotated screenshot and
  comment without modifying the PDF file. Escape also closed annotation while
  keyboard focus remained on the toolbar, without an extra click in the PDF.
- After an intentional resource-monitor failure, a manual Retry restored the
  monitor and cleared stale errors from both the telemetry and legacy process
  and history panels.
- Live HTML previews in dark and light appearance produced matching screenshots
  and reported the expected media-query and computed text-color values.

PR-watch timing and stale-cache event ordering are covered by deterministic
tests; this record does not claim those scenarios were reproduced through the UI.
The desktop build and scoped web, desktop, contracts, and client-runtime
typechecks passed. The server typecheck reports four existing Effect diagnostics
in unchanged `AppMcpOAuth.ts` and `AppMcpOAuth.test.ts`; none remain in changed
files. No repository-wide test or typecheck was run.
