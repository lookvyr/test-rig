# October 14 streaming and Git reliability intake

Adapted four changes from T3 Code nightly
`v0.0.46-nightly.20261014.3118` (`7ac952c630ef8a60d14ca8f6a0c7adce33db4bae`)
to Test Rig at `80031a7db5`. No migrations, provider registrations, or wire schemas
changed.

| Upstream                                                 | Change                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#18890](https://github.com/pingdotgg/t3code/pull/18890) | Non-thread events patch the thread activity timestamp with SQL `json_set`, using the schema's existing date codec. They no longer read, decode, and encode the entire thread payload.                                                                                                               |
| [#19411](https://github.com/pingdotgg/t3code/pull/19411) | Both scoped and full remote fetches retry one recognized ref-lock failure. Persistent locks keep the existing fixed diagnostic; unrelated failures do not retry. Git 2.53 ref-update diagnostics are recognized.                                                                                    |
| [#18754](https://github.com/pingdotgg/t3code/pull/18754) | Worktree checkout revisions are recorded as PR bases only when they name branches. Legacy commit, tag, and revision settings fall through to normal PR-base selection. Valid local, remote-tracking, and remote-only branches are preserved. Exact local branch names win over colliding tag names. |
| [#19317](https://github.com/pingdotgg/t3code/pull/19317) | Codex proposed plans use the existing text coalescer at 400 ms. Completion preserves authoritative or buffered final text. Turn termination flushes buffered text, leaving interrupted or failed proposals unfinished. The first delta reserves its timeline position before buffering.             |

The plan adaptation retains Test Rig's parent/child projection ownership and
turn-keyed buffers. Steering-only input, recursive Stop, and PR-watch lifecycle
are unchanged. The Git work stays in the existing driver and manager rather than
importing upstream's provider package reorganization.

## Verification

- Focused verification passed 552 tests across seven files: projection store,
  Git driver, Git manager, Codex adapter, replay fixture integration and contracts,
  and thread launch. Review follow-ups add branch/tag collision coverage and
  assert plan ordering against a command received before the plan flush. All 394
  tests in the three affected suites passed again after the review fixes.
- Server typecheck, scoped lint, formatting, and diff whitespace checks pass.
  Scoped lint reports only existing unused-variable warnings. No repository-wide
  checks were run.
- The primary agent booted the worktree-local web stack with isolated `.test-rig`
  state and a disposable Git repository with a local bare remote. A real Codex
  plan-mode turn produced all 25 requested steps in 11 persisted plan updates,
  mostly about 400 ms apart. Its final 2,720-character plan was completed.
- Stop during a second plan retained 5,428 characters with `streaming: true` and
  unfinished item status. The interrupted plan remained visible after reload.
  The thread's SQL timestamp and payload timestamp matched after activity.
- A fixture injected one Git 2.53 ref-lock failure into a worktree launch.
  The running server attempted that scoped fetch exactly twice, created the
  worktree, and completed a real Codex turn. A branch-based worktree recorded
  `main` as its PR base. Commit/tag/revision bases and legacy PR creation fallback
  are covered by real disposable Git repositories and simulated hosting calls.
- A separate agent found and re-reviewed two fixes: preserve first-seen plan
  ordering and configured branches that share names with tags. Fetch test setup
  was consolidated into one local scenario table. The second review found no
  remaining correctness or worthwhile simplification changes.

The browser reported no console errors in the final acceptance flow. Existing
Legend List recycling and scroll-convergence warnings appeared during testing.
No real external PR was created. Packaged Electron, other operating systems,
remote connections, and an extended disk/performance soak were not tested.
