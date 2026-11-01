# November 1 command palette ranking intake

This intake adapts upstream [T3 Code](https://github.com/pingdotgg/t3code)'s shared palette
ranking from [#24343](https://github.com/pingdotgg/t3code/pull/24343), as shipped in
`v0.1.7-nightly.20261101.4016`. It completes the parts of #24343 that the
[October 24 follow-up](./upstream-followup-2026-10-24.md) left out: title ranking, open
frequency, and remembered picks. Upstream code remains covered by the repository's MIT license
and attribution.

## Ported

- `packages/shared/src/paletteSearch.ts` and its tests, unchanged except for the worktree
  branch prefix, which strips `test-rig/` as well as upstream's `t3/` and `t3code/`.
- Cmd+K thread, project, action, and submenu-suggestion rows rank through
  `scoreThreadSearch`, `scoreSearchTerms`, and `rankSearchGroups`, with upstream's group
  order, thread limit, three-row secondary limit, match hints, and the open thread listed last.
- `OrchestrationV2ThreadOpens` on the app thread and shell summary, with lenient decoding.
  `thread.visit` accepts `opened` and `searchQuery`; the orchestrator records opens on the
  server clock. Forks start without their source's history. Opens live in the thread payload,
  so no migration is needed.
- Client-side open claiming (`claimThreadOpen`) and the merged search subject
  (`threadSearchSubject`) in `packages/client-runtime/src/state/threadSearch.ts`.

## Adapted

Test Rig's web client keeps its own read watermark and did not previously send `thread.visit`.
It now sends one only to record an open: when a thread view mounts, and when a palette pick
carries its query. Both send the thread's creation time as `visitedAt` so the server's
watermark does not move. Opens are deduplicated per thread for ten minutes on the client and
merged by the server within the same window.

The **In messages** section keeps Test Rig's server ranking and environment/thread
deduplication; upstream's client-side `rankMessageMatches` and shown-order stabilization are
not used. Server thread search, the MCP thread toolkit, sidebar search, and settings search
keep their existing ranking.

## Verification

Focused tests cover the shared ranker (upstream's suite), palette ranking and hints, client
open claiming, and server open recording. Two independent review rounds found no remaining
issues. In an isolated running app, word-order, accent, typo, pull request, and group-order
searches behaved as described, and a pick was recorded once and ranked first after a reload. Scoped contracts, shared, client-runtime, web, and
server typechecks pass apart from one existing server test diagnostic.
