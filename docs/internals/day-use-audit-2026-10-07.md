# Desktop day-use audit — 2026-10-07

## Scope and environment

Baseline: `codex/orchestration-v2`, fast-forwarded to `021970c08`
(`feat(secrets): add private cards for browser sign-in`). Five GPT-6.1 Sol
reviewers inspected upgrade/recovery, providers/delegation, Git/worktrees,
browser/HTML/private input, and client behavior. The primary agent drove the
native macOS desktop through computer use. This was a bounded acceptance pass,
not an eight-hour soak or certification of every provider/platform combination.

The desktop used an isolated application home at
`/tmp/test-rig-day-audit-0xkgm2gs`, with a consistent SQLite backup of real legacy
state and a disposable Git repository. The live application database was not
opened for writes or used by the test server. No provider credentials were
changed. Existing provider CLI authentication was used for harmless test turns.

## Live results

| Flow                 | Evidence from this pass                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade and history  | First V2 boot imported all six legacy messages unchanged. Four earlier assistant notes were inside the intentional “Worked for 26s” fold; expanding it exposed them.                                      |
| Codex chat           | Read a file, created a file, remembered a marker, generated a checkpoint/diff, and continued after desktop restarts.                                                                                      |
| Provider switching   | Same chat switched to Claude Opus and OpenCode Big Pickle; both retained the original marker. Claude changed the fixture file successfully.                                                               |
| Provider failures    | Claude Fable hit its account usage limit. OpenCode GPT-6.1 Sol returned native `provider.auth`; Big Pickle worked. These are model/account caveats, not a successful test of those particular selections. |
| Limit controls       | Scheduled then canceled auto-resume; snoozed then woke the limited chat. Independent default settings remained off.                                                                                       |
| Stop and steering    | Stopped a long-running command. A separate active turn accepted steering and returned the changed instruction’s marker.                                                                                   |
| Images and drafts    | Attached an image through the native picker, navigated away/back with the draft intact, sent it, and received the correct visual description.                                                             |
| Durable fork         | Fork preserved inherited history and parent link. The fork recalled the original marker.                                                                                                                  |
| App-owned child      | Parent delegated a read-only README task to Claude; received the requested heading and child completion marker.                                                                                           |
| Chat references      | Selected a chat reference in the composer; agent read that chat and recalled its marker.                                                                                                                  |
| Side conversation    | Side panel answered using parent context and the rendered artifact title.                                                                                                                                 |
| Git                  | Review displayed actual file changes. UI-generated local commit succeeded in the disposable repository. No remote push/PR mutation.                                                                       |
| Worktree handoff     | Existing conversation moved into a new worktree, automatically continued there, verified branch/path/history, and created a file only there.                                                              |
| Terminal and files   | Terminal used the new worktree path. File browser opened the new file; edits persisted on disk.                                                                                                           |
| Save/stash shortcuts | After repair, Cmd+S in the shadow-root file editor did not open composer stash. Cmd+S in composer still stashed a draft, which restored intact.                                                           |
| Inline HTML          | After CSP repair, an interactive card rendered both inline and in the panel; its button changed text when clicked.                                                                                        |
| Native browser       | Opened disposable local page, clicked button, typed ordinary input. After screenshot repair, the agent obtained a snapshot and clicked the button successfully.                                           |
| Scheduled tasks      | Created paused task, manually ran it, observed actual `SCHEDULE_OK` response, edited name/cadence, and verified it survived desktop restart still paused. No wall-clock recurring dispatch test.          |
| Archive recovery     | Archived disposable schedule-result chat; restored it through Settings → Archive and verified it returned to the sidebar.                                                                                 |

## Repairs discovered during this pass

Private input passed the follow-up live desktop check at 18:58 local time after
the user terminated the old dev app and the same isolated environment was
relaunched. A fresh private card filled the local fixture using the default
timeout; desktop IPC and PreviewManager typing spans both completed successfully.
The dummy value was absent from logs. The restored composer draft also retained
its exact contents after restart. The earlier computer-use attachment timeout
was resolved by replacing the dev app instance; no accessibility code change was
needed.

- Removed duplicate Playwright entries that made the frozen lockfile install
  fail. The canonical package, integrity and importer versions are unchanged;
  a frozen install then succeeded.
- Removed an upstream rewrite when reusing a local branch for a fork PR. A real
  Git regression failed before the fix and passed afterward. The unrelated
  branch keeps its existing upstream.
- Kept an isolated browser context alive until its final tab finishes closing,
  so closing the opener no longer destroys a surviving popup. Covered delayed
  concurrent tab closes without timing sleeps.
- Allowed HTTP/HTTPS frames in Electron’s renderer CSP so signed HTML attachment
  URLs work from the custom desktop protocol and explicit remote environments.
  The HTML iframe sandbox remains intact.
- Switched native preview snapshots from failing/stalling `capturePage()` to the
  existing debugger’s `Page.captureScreenshot`, retaining image bounds/PNG output.
- Omitted an absent private-entry timeout from the opaque browser request payload.
  Sending `timeoutMs: undefined` failed the actual JSON wire codec and disconnected
  the automation host before desktop IPC. This reproduced twice live and in a
  focused wire-encoding proof; the private value stayed out of logs and history.
- Respected editable targets in a key event’s composed path, fixing Cmd+S in the
  file editor’s shadow root without disabling composer stash.
- Updated the Claude read-only tool enumeration test for the already-shipped
  HTML toolkits and added upgrade guidance to the user install documentation.

The runtime changes received a separate simplification/review pass. Live
verification found the initial save-shortcut guard insufficient because of
shadow DOM retargeting; the final composed-path guard passed native rechecking.

## Focused verification

The initial pass used focused checks. The user subsequently authorized full
repository checks; those results are recorded separately below.

- Git/worktree/fork/GitHub: 428 unique focused tests across 14 files; final
  GitManager suite 128 passing tests is included in that number.
- Provider/delegation: 560 unique focused tests; final Claude suite 139 passing
  tests is included in that number.
- Upgrade/recovery: 34 focused tests, plus source migration comparison and
  read-only comparison of source/imported live fixture messages.
- Browser/HTML/private-tool focused set: 85 passing tests; 16 tests requiring
  actual Chromium were skipped. ServerBrowser’s 14 passing tests are included.
- Desktop preview: 44 tests; Electron protocol: 6 tests; save-shortcut/helper:
  7 tests across two files.
- Private browser entry: 4 handler tests, including absent and explicit timeout
  requests encoded/decoded using the real RPC JSON codec.
- Scoped server, web and desktop typechecks passed. Targeted lint/format and diff
  checks passed, with existing lint/Effect suggestions noted by the reviewers.
- `vp run build:desktop` completed successfully, rebuilding web, server and
  Electron bundles. This is build verification, not an installer/signing test.

These are per-area counts, not an asserted deduplicated grand total.

## Full-repository follow-up

The user requested all tests, typechecks, and lint after the initial acceptance
pass. This exposed additional runtime defects and stale fixtures that the
initial focused checks had not covered:

- Canonicalized the configured application-home and worktree paths before
  scanning imported sessions. On macOS, `/var` and `/private/var` aliases could
  otherwise let an app-managed worktree appear as an unrelated project.
- Preserved GitLab merge-request closing/merging timestamps through decoding
  and provider mapping.
- Published Codex approval/question cards before actionable requests. An
  immediately answered request could previously settle before its card was
  created, leaving a stale waiting card.
- Preserved private browser parameter descriptions in the exported tool JSON
  schema, including branded tab and secret references.
- Repaired fixtures for current V2 databases, SDK contracts, tool names,
  scheduling/completion policy, and router ownership. Restart replays now bind
  the real delegated-task recovery service used by production.
- Removed broken registrations for absent recordings and orchestration replays
  of excluded rewind behavior. Historical captures remain available for native
  protocol validation; a contract test prevents rewind commands from returning
  to the supported orchestration fixture set.
- Updated the V1 boundary check to inspect the shipped CLI dependency graph,
  allowing only the two shared orchestration helpers and rejecting reachable
  V1 runtime services/readers. Legacy payload-preservation tests now assert the
  retained database data directly.
- Fixed the lint-plugin typecheck script to invoke the installed compiler and
  formatted existing drift discovered by the repository-wide formatting gate.

These changes received independent review. The full real-Chromium preview/HTML
checks were enabled using an existing headless-shell binary: all 19 passed,
including the 16 browser checks skipped in the initial focused pass. The native
Rust resource-monitor suite also passed all 15 tests.

Final typechecking passed across all 10 workspace targets, with zero errors and
1,318 Effect suggestions. Full lint passed with zero errors and 323 warnings.
The final desktop production build passed after the runtime fixes. The rebuilt
development desktop reopened the saved worktree file and exact composer draft.

The final root `vp run test` exited successfully across all 10 targets. It ran
832 test files with **9,260 passed, zero failed, and one skipped**. Package totals:

| Package                 | Test files | Passed tests | Skipped |
| ----------------------- | ---------: | -----------: | ------: |
| Contracts               |         31 |          346 |       0 |
| Effect Codex app server |          5 |           36 |       0 |
| Shared                  |         39 |          433 |       0 |
| SSH                     |          4 |           25 |       0 |
| Scripts                 |         12 |          117 |       0 |
| Lint plugin             |          4 |           35 |       0 |
| Client runtime          |         61 |          567 |       0 |
| Desktop                 |         52 |          420 |       0 |
| Web                     |        257 |        2,491 |       0 |
| Server                  |        367 |        4,790 |       1 |

The separate Rust suite adds 15 passing tests. The final full formatting and
whitespace checks passed. Full-check logs are retained in the isolated audit
home as `full-tests.log`, `full-native-tests.log`, `full-typecheck-final.log`,
`full-lint-final.log`, `full-format-final.log`, and `build-desktop-final.log`.

The remaining automated skip is the pre-existing opt-in live Codex V1-engine
runtime-mode test in `orchestrationEngine.integration.test.ts`, gated by
`CODEX_BINARY_PATH` and pinned to an older model. It was not enabled for this V2
acceptance pass. Actual V2 Codex execution was verified in the desktop. The
separate eight-second desktop smoke launcher was not run because it selects the
production Electron profile; the isolated native desktop was built, launched,
restarted, and exercised directly instead.

## Upgrade boundaries and remaining coverage

Before installing on the other machine, close Test Rig and back up its entire
application home. Preserve any custom `TEST_RIG_HOME`. V2 initializes a separate
`statev2.sqlite` from the existing database and retains the original. After first
launch, V1 and V2 databases are not synchronized: returning to main does not show
new V2 work.

Imported chats have saved history but start fresh native provider sessions with
budgeted history handoff and older-history retrieval. Legacy checkpoint/native
session records remain in copied tables; they are not equivalent to resumed V2
provider/checkpoint projections. Temporary side conversations are not imported.

This pass did not install a signed/package artifact on the destination machine,
exercise authenticated remote GitHub mutations, force crashes during migrations,
test Windows/Linux or remote/SSH clients live, or run a sustained performance
soak. Approval gates and less common recovery branches rely on focused tests and
inspection rather than a complete live matrix. Browser profile/login persistence
was not tested with real credentials.

The development launcher left stale PID ownership locks after shutdown. Each was
preserved only after confirming its recorded process was gone. This is a dev
launcher limitation observed here; it is not evidence of a packaged-app failure.

## Readiness judgment

Scores express engineering confidence for a day of use of the repaired build;
they are not measured failure probabilities. A score of 9 means strong evidence
for ordinary use, with untested edge cases remaining.

| Primary flow                                | Confidence / 10 | Main limit                                                                                                  |
| ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| Core chat, tools, stop and steering         | 9               | No full-day workload/soak.                                                                                  |
| Provider switching                          | 8.5             | Account/model availability matters; two specific selections failed upstream.                                |
| Upgrade and saved history                   | 8.5             | Real copied source was small; larger histories rely on focused fixtures. Destination machine not exercised. |
| Attachments, drafts, stash and references   | 9               | Bounded image/reference cases, not every attachment format.                                                 |
| Forks, child agents and side conversations  | 8.5             | Live happy paths plus code/tests; exhaustive restart/interleaving matrix omitted.                           |
| Worktree handoff, terminal and file editing | 8.5             | One live local repository; platform/remote cases rely on tests.                                             |
| Local Git review and commit                 | 8.5             | Authenticated remote PR mutation not performed.                                                             |
| Inline HTML and ordinary browser automation | 8.5             | Live repairs verified locally; broader sites and remote hosting not driven.                                 |
| Scheduling and thread lifecycle             | 8               | Manual dispatch and persistence verified; no clock-driven or sleep/wake soak.                               |
| Remote/SSH and uncommon recovery paths      | 6.5             | Primarily code/tests, not live destination coverage in this pass.                                           |
| Private browser input                       | 8.5             | Default-timeout path now passes live and exact wire regressions pass; real-site login not exercised.        |

Overall target: suitable for a day of ordinary local desktop use once this
audit's repairs are included in the build installed on the other machine.
Install the commit containing this audit report or a later commit on
`codex/orchestration-v2`; the baseline commit `021970c08` does not include these
repairs.
