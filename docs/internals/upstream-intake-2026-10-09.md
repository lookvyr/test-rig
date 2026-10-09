# October 9 upstream reliability and performance intake

Compared the requested upstream PRs with Test Rig at `fd284c509b`, using the
October 9 nightly `v0.0.46-nightly.20261009.2886` as a source reference.
These ports retain the local-first boundary in `FORK.md`; they do not add
providers, cloud services, dependencies, or a new wire format.

| Upstream change                                                                  | Test Rig adaptation                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#17041: command retry](https://github.com/pingdotgg/t3code/pull/17041)          | Pin the command-ID index in the active V2 event store. The upstream legacy-store path is not the active local seam.                                                                                                                                                                                    |
| [#17028: held delegated work](https://github.com/pingdotgg/t3code/pull/17028)    | Exclude held queued runs from pending work and recovery decisions; settle the queue before finalizing a child. Preserve side-chat ownership locks.                                                                                                                                                     |
| [#17029: long-thread queries](https://github.com/pingdotgg/t3code/pull/17029)    | Sort narrow timeline IDs before retrieving payloads; add two partial indexes through V2-only migration 44. Preserve the historical V1 ledger.                                                                                                                                                          |
| [#17141: shell decoding](https://github.com/pingdotgg/t3code/pull/17141)         | Read a consistent shell/projects/sequence snapshot in a transaction, then decode shell rows after releasing it. Update Test Rig's active and archived stream loaders.                                                                                                                                  |
| [#15033: streaming efficiency](https://github.com/pingdotgg/t3code/pull/15033)   | Reduce shell-history reads, suppress unchanged shell updates, preserve unchanged client objects, emit Codex message text once at completion, and use filtered event streams for MCP waits. Limit composer shell subscriptions to the mention menu. Existing static automation indicators need no port. |
| [#16272: repository discovery](https://github.com/pingdotgg/t3code/pull/16272)   | Cache successful discovery for five minutes with filesystem validation; share identical origin lookups. Extend upstream validation for linked-worktree markers, replaced gitfiles, and aliased paths. Keep disabled hosting integrations gated.                                                        |
| [#17408: Claude MCP credentials](https://github.com/pingdotgg/t3code/pull/17408) | Put the bearer header in `TEST_RIG_MCP_AUTHORIZATION` in the child environment, with a placeholder in argument-bound MCP configuration. Include the environment value in query reuse decisions so rotation takes effect.                                                                               |
| [#17360: browser drag failure](https://github.com/pingdotgg/t3code/pull/17360)   | Observe drag rejection immediately, then return the action failure after cursor handling without an unhandled rejection.                                                                                                                                                                               |
| [#17383: sidebar resizing](https://github.com/pingdotgg/t3code/pull/17383)       | Commit existing `ChatCanvas` resize measurements before paint with `flushSync`; retain Test Rig's composer, timeline, and panel measurements.                                                                                                                                                          |
| [#17387: bounded history sync](https://github.com/pingdotgg/t3code/pull/17387)   | Reuse visibility lookups, hydrate only needed ancestor fields, fetch payloads by row ID, and avoid redundant budget serialization. Preserve pending requests and imported fork history.                                                                                                                |

## Verification requirements

Query-plan assertions cover command replay, user-message boundary selection,
live-node lookup, and payload retrieval without sorting large JSON bodies.
Snapshot regressions cover pending approvals/questions, rollback/interrupt
visibility, nested forks, imported history, equal ordering keys, and oversized
actionable control state. Shell tests check both snapshot consistency and that
decoding runs outside the read transaction.

Provider and lifecycle tests cover held queues, event-driven waits, completed
and interrupted Codex text, and Claude credential rotation through the actual
query-open path. Git tests use real repositories and linked worktrees in
addition to subprocess-count assertions. Browser drag rejection is tested while
cursor handling is still pending.

Upstream benchmark percentages are not Test Rig measurements. SQL fixture
timings and query plans demonstrate narrower work; they do not establish the
same improvement in end-to-end UI latency on a user's database.

## Verification results

Focused persistence, orchestration, MCP, provider, Git, browser, and client
regression suites passed. Scoped server, web, and client-runtime typechecks
passed. Scoped lint reported no errors, with existing warnings remaining;
`git diff --check` passed. No repository-wide checks were run.

The integrated web pass used isolated development state. A real Claude session
successfully called MCP capabilities and delegated a child in wait mode. Process
arguments contained the environment placeholder and no literal bearer header.
Codex streamed a complete response and retained partial text after Stop.
Sidebar and details-panel resizing kept the main composer, side chat, and
terminal aligned; multiline drafts survived resizing. Thread/file mentions
still populated. The browser console reported no warnings or errors during
the layout pass. The shared web renderer was exercised; a packaged desktop
smoke test and remote/tunnel connection test were not run.

A synthetic SQLite comparison exercised 24 snapshot configurations over 6,039
rows. Old and new SQL returned byte-equivalent results, with approximately
39 ms versus 25 ms total query time in that run. This is a SQL-only fixture
measurement, not an end-to-end performance claim.
