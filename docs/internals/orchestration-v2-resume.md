# Orchestrator V2 — October 6 pause and October 7 resumption

Resumed at the user's request on October 7. The three recorded test failures are resolved; final server verification passed 1,575 tests in 55 files, and the independent review closed R01–R34 with no outstanding finding. See the [reliability implementation report](orchestration-v2-reliability-implementation.md) for current status. The checklist and counts below preserve the historical pause state. All implementation changes remain uncommitted on `codex/orchestration-v2`, based on `2cd9bf400cefedd19206b09ff4f8d880a176d915`. Preserve the entire working tree, including the earlier UX repairs. No commit, push, PR, or Linear update was performed.

## Checklist recorded at the pause

1. **Investigate the combined server regression timeout** in `apps/server/src/orchestration-v2/runtimeLayer.test.ts:253`: “production run services refresh branches before turn end and workspace after capture.” It timed out after 60 seconds. The new terminal/checkpoint ownership guard may interact with its fixture; this is a hypothesis, not a diagnosis. Use typed receipts/drains, not sleeps or a larger timeout. Runtime agent owned this slice.
2. **Update two stale native-fork replay tests** in `apps/server/src/orchestration-v2/testkit/ThreadFork.integration.test.ts`. They still expect `checkpoint.rollback`, which correctly fails under Test Rig's no-rewind policy. Preserve meaningful source/fork independence and earlier local-boundary coverage through durable forks, and assert the exclusion where appropriate. Do not re-enable rewind or skip the tests. Provider agent read these cases but made no follow-up edits before pause.
3. **Finish the independent correctness/simplification review.** Client, contracts/editor, transport/storage, coordination and Git received incremental review. Final runtime/provider review and integrated R01–R34 closure remain incomplete. Domain findings and reviewer pause notes are saved beside this document.
4. **Rerun only the affected focused tests**, then rerun the saved combined server manifest if needed to establish the final integrated result. Update scoped typechecks/lint when edits warrant it. No repository-wide checks.
5. **Finish the runtime domain report and aggregate reliability report.** `orchestration-v2-reliability-implementation.md` is a draft; its validation section is unfinished. Do not claim all bugs fixed or the task complete until the above failures and review are resolved.

## Verification already completed

- Client/web/desktop/shared/contracts batch: **642 passed in 54 files**.
- Combined server batch: **1,571 passed; 3 failed in 55 files**. The three failures are exactly the timeout and two stale fork tests listed above. Do not treat this batch as green.
- Scoped web, desktop, contracts, shared, client-runtime and server typechecks exited 0. The last runtime MCP regression was added afterward; its 16-test suite and targeted lint passed independently.
- Changed-file lint over 271 source/test files exited 0 with existing warnings. `git diff --check` was clean before the final test-only additions; recheck when resuming edits.
- Production desktop rebuilt and started. Existing conversation history and paused bound automation survived restart. A new Codex turn sent from desktop completed with “reliability check passed” and appeared in the web client.
- Rich-text boundary typing passed in browser before/after bold text and in desktop before bold text. Unsent formatting fixtures were cleared. Screenshots are in `orchestration-v2-live-audit-2026-10-06/reliability-evidence/`.
- Restored OpenCode and provider memory tests passed. The memory fixture found an additional real transcript retention bug, repaired by moving the native child-history loader factory out of the large startup closure.
- Effect stays 4.0.0-rc.115. Final applied patch hash: `857854b8a1069af84123ea9dc9063e110656ac6eb76b947107c3eb92410dac40`. Frozen install passed; no dependency version upgrade.

## Saved evidence and owner notes

`orchestration-v2-live-audit-2026-10-06/reliability-reports/` contains domain reports, all three pause notes, incomplete independent-review inventory, client/server manifests and results, and lint output. These durable copies replace reliance on `/private/tmp` across reboot. Focused domain counts overlap the aggregate batches; do not add them together.

## Test environment restart

The task-owned Test Rig dev stack (last session 26533), comparison nightly (89998), and fixture HTTP server (66983) were stopped using their captured sessions. Agent-owned checks had already finished. No processes were killed by name/pattern. No scheduled wakeup was created.

Original isolated Test Rig home: `/private/tmp/testrig-live-parity-86ipk174/test-rig`; last ports server 13773/web 5733. Fixture browser site: `/private/tmp/testrig-parity-browser-fixture`, port 53460. The browser tab was retained, but may need reopening/authentication after reboot. Never use live shared application state.

A gitignored backup of the isolated environment and fixture site is saved at `.test-rig/reliability-resume-20261006/environment.tar.gz` in this checkout, excluding caches, logs and node_modules. It includes state, fixture repositories and symlinks. If `/private/tmp` contents disappear, extract this archive under `/private/tmp` to restore the original absolute paths so saved project/worktree paths continue to resolve. Do not overwrite surviving state without inspecting it first. Backup auth/settings stay outside committed docs.

Restart from the repository root with:

```sh
PATH="$PWD/node_modules/.bin:$PATH" node scripts/dev-runner.ts dev:desktop --home-dir /private/tmp/testrig-live-parity-86ipk174/test-rig
```

Read actual ports from the dev-runner output. If launcher ownership reports a stale lock, read its exact recorded PID and remove only that exact lock after proving the PID no longer exists. Do not pattern-kill. Use the test-t3-app skill for pairing/restart. The previous test OpenCode binary lived under `/private/tmp/testrig-opencode2-verification/package/bin/opencode`; if absent after reboot, restore it from the official package before claiming a fresh OpenCode live test. Prior live provider results remain historical evidence.
