# Worker and SQLite reliability repairs — October 6, 2026

Implemented the owning fixes requested by the primary agent in `/Users/smills/REPOS/test-rig`. Read AGENTS.md/FORK.md, `.repos/effect-smol/LLMS.md`, the runtime audit appendix, and pinned upstream worker/SQLite sources. Adapted behavior from `24e4b62c8` (DrainableWorker item isolation) and `0fe4fa40f` (SQLite early write-lock acquisition and Node error-code normalization). Existing Effect rc115 imports remain; no dependency, manifest or patch changes were made by this work. Previous collaboration UX changes were preserved. No app/provider launches, live database access or commits.

## Changes

- `packages/shared/src/DrainableWorker.ts:53` removes queued items from outstanding accounting atomically when shutdown drops them. An in-flight item still decrements itself through its finalizer. Rejected enqueue after shutdown does not increase outstanding (`:89`). Drain resolves when accepted work has either completed or been dropped by shutdown.
- `DrainableWorker.ts:64` suspends processor construction and catches an individual item's failure/defect/self-interruption. Failures and defects are logged, self-interruption remains a quiet cancellation, and later accepted work is processed. Interrupting the worker via scope closure still terminates it. No restart loop, alternate queue, public API or new service was introduced.
- Both `apps/server/src/persistence/NodeSqliteClient.ts:286` and `packages/shared/src/nodeSqliteClient.ts:281` use `BEGIN IMMEDIATE` on writable connections, acquiring the write lock before reads. Explicitly read-only connections keep deferred `BEGIN`. Existing per-client semaphore, connection lifecycle, memory client and SQL API remain unchanged.
- Both client helpers normalize a native numeric `errcode` into the classifier's `errno` when `errno` is absent (`server:100`, `shared:91`). This lets existing Effect classification report lock timeout and constraint reasons instead of UnknownError. The normalization is used at open/close/prepare/execute/values/reset-result-mode boundaries.

## Deterministic tests

`packages/shared/src/DrainableWorker.test.ts:22` covers typed failure, effect defect, self-interruption and a processor throwing while constructing its effect, followed by successful work. It verifies failure/defect logs and quiet self-cancellation. A failed worker's exit resolves the regression race rather than hanging a drain assertion. `:57` verifies scope-close interruption, queued-work dropping, quiet shutdown, rejected enqueue after close and immediately completed drain. `:89` preserves the receipt-based active-processing/enqueue/drain ordering test. No sleep or timeout is used as correctness evidence.

Both SQLite suites verify actual disposable Node WAL connections:

1. A writable transaction reads, a second connection's write is rejected, then the transaction writes and commits; the second connection can commit afterward. This directly prevents the previous read-to-write snapshot invalidation (`server test:85`, `shared test:100`).
2. An already-held writer blocks transaction start with typed LockTimeoutError; the same transaction succeeds after release (`server:112`, `shared:127`). SQLite busy timeout is set to zero so the test does not wait on elapsed time.
3. A read-only transaction preserves its old snapshot while another WAL writer commits, then sees the new value after completion. Writes through the read-only client still fail without changing the stored value (`server:130`, `shared:145`). This confirms the read-only path did not acquire the writable reservation.
4. Native unique and NOT NULL violations classify as UniqueViolation and ConstraintError (`server:49`, `shared:64`). Existing query/open-failure and shared prepared-query recovery tests are retained.

## Checks

- `./node_modules/.bin/vp test run packages/shared/src/DrainableWorker.test.ts packages/shared/src/nodeSqliteClient.test.ts apps/server/src/persistence/NodeSqliteClient.test.ts` — **3 files, 19 tests passed**.
- Targeted `vp lint` on all six changed worker/client/test files — passed with no warnings.
- `vp fmt` on those six files — completed; `git diff --check` for them — passed.
- `./node_modules/.bin/tsc --noEmit -p packages/shared/tsconfig.json` — passed (existing Effect suggestion diagnostics only). Primary owns integrated server/type checks after concurrent agents finish.

## Practical limits and simplification

Writable-connection transactions now reserve the writer lock even when their body only reads, matching the selected upstream repair. This avoids a deferred-lock upgrade failure but can serialize such transactions against other processes' writers earlier. Existing Node SQLite calls remain synchronous; this change does not add longer busy timeouts, retries or promises of parallel write throughput. Tests prove correctness and classification, not a contention benchmark.

The changes remain at the existing helper boundaries. The two SQL implementations are retained rather than consolidated during a reliability repair, and the existing queue accounting model is retained rather than introducing worker restarts or receipt systems. No separate new findings remain in this assigned scope. The primary's final independent simplification/review pass still applies to the integrated changes.
