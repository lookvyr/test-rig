# Client persistence and desktop reliability repairs — October 6, 2026

This pass implements the remaining client/desktop/settings findings from the current source audit, preserving the earlier parity changes. No applications or providers were launched, no live state was written, no commits or Linear changes were made, and no repository-wide checks ran. Ports retain the installed Effect rc115 APIs; no stable-Effect, cloud/relay, or periodic bootstrap-token rotation behavior was imported by this slice.

## Dispositions

### R23 / C1 — IndexedDB stale handles and aborted writes: fixed

Adapted upstream `9c49228f5`. `apps/web/src/connection/storage.ts:166` now owns a lazy shared database handle. Its acquisition lock prevents concurrent operations from opening duplicate connections. Browser `close` invalidates the handle; `versionchange` invalidates and closes it so another window can upgrade. The next access reopens.

`storage.ts:208` catches only an initial operation's typed `InvalidStateError`, invalidates the specific stale handle and retries once on a replacement. A failed initial open is not retried; a replacement that also fails propagates its typed error. The independent simplification review replaced upstream's artificial Symbol error marker with a narrower catch around the first operation.

Synchronous open/transaction/cursor errors now become typed persistence errors. Write and both removal paths listen for transaction `abort`, including quota/commit failures that never emit `error`, so callers complete with failure instead of staying pending. Wire/cache schemas and database generations are unchanged.

Focused tests cover initial acquisition failure, concurrent initial acquisition, forced `close`, `versionchange`, concurrent reopening, closure without a delivered event, exactly one replacement retry, abort-only writes, abort-only thread/range removal, and finalization of the current connection. The existing catalog sanitization/desktop secure-store failure tests remain.

### R24 / C2 — Secondary desktop usable credentials, rejection backoff and owned drafts: fixed

Adapted upstream `f36df1852`. `apps/web/src/connection/platform.ts:466` reconciles secondary registrations through one effect, with its loader replaceable for deterministic tests. The actual platform source calls this same resolver at `:642`.

Cached bearers are keyed by their HTTP/WebSocket endpoint; the bootstrap token identifies the exchange and rejection state separately. A token change attempts a fresh exchange but retains the identical, unexpired registration if that exchange fails. Reconciliation therefore keeps its runtime and owned data, rather than treating the backend as removed and clearing drafts. Expired bearers and different-endpoint credentials are not retained; successful backend disappearance remains authoritative.

Authentication rejection backs off on the exact endpoint/token signature, beginning at one minute and doubling to a thirty-minute cap. New tokens/endpoints retry immediately, transient failures do not acquire credential-rejection backoff, and successful topology reconciliation prunes obsolete rejection state. A backend restarted on the same port can eventually recover with the same token.

Resolver tests exercise token-change rejection, unchanged registration identity, skipped subsequent polls, immediately retried token changes, expiry, endpoint changes and removal. The actual client-runtime registry test checks that repeating the retained bearer creates no replacement session or cache/owned-data cleanup, while an explicit absent registration does invoke cleanup. This combines producer and consumer evidence for draft safety. No live WSL/secondary backend or real rotated-token run is claimed. No new periodic rotation machinery was added.

### Native transient bearer bootstrap retry: selected resilience candidate, implemented and verified

Adapted upstream `76d3c96fd`. `apps/desktop/src/backend/DesktopLocalEnvironmentAuth.ts:21` defines a fifteen-second bound and five-hundred-millisecond retry interval; `:104` applies the retry before mapping the error. Only fetch/timeout and undeclared 502/503/504 failures retry. A rejected credential or ordinary server error is final.

Native tests prove two transient 503 failures can recover, 401 authentication rejection is attempted once, 500 is attempted once, persistent 503 failure terminates within fifteen seconds with no later attempts, and successful token reuse retains the existing exchange-once behavior. TestClock supplies deterministic virtual time; no real sleep or native startup failure was required. This was originally an adaptation candidate, not a demonstrated ordinary startup regression; the user's request to resolve the remaining known reliability work selects the fix. No native startup smoke is claimed.

### R26 — Shared settings symlink replacement: confirmed and fixed

Current source confirmed the bug: server atomic writes and both desktop writers renamed a temporary file onto the link itself, replacing the symlink with a regular file. Adapted upstream `00eb8f618` coherently.

`packages/shared/src/symlink.ts:22` resolves absolute/relative chains and dangling file links, including relative targets whose parent directory is itself linked. Unreadable links and cycles fail before rename. The helper has one shared subpath export.

`apps/server/src/atomicWrite.ts:14`, `apps/desktop/src/settings/DesktopAppSettings.ts:367`, and `DesktopClientSettings.ts:107` write their temporary file beside the resolved destination and rename onto that destination, preserving every link in the chain. Desktop error schemas identify failed link resolution explicitly.

`apps/server/src/serverSettings.ts:514` watches the link file and its resolved target directory. Link changes resolve the target again and switch the destination watch; dangling targets prepare their destination directory. This keeps external edits to shared settings visible after preserving the link.

Real filesystem tests cover existing/dangling/chained links, relative links under linked parents, missing paths, cycles, unreadable links, and actual server/desktop/client-settings service saves. The server watcher regression uses an acquired subscription receipt and controlled target-directory event plus TestClock for the production debounce; it proves a destination event updates the settings stream without sleeps or polling. The repoint-following implementation follows the pinned upstream source; this pass did not run an additional native filesystem watch/repoint smoke.

## Verification

Final focused suite: **98 tests passed in eight files**:

- Web `connection/storage.test.ts` and `connection/platform.test.ts`.
- Client runtime `connection/registry.test.ts`.
- Desktop `backend/DesktopLocalEnvironmentAuth.test.ts`, `settings/DesktopAppSettings.test.ts`, `settings/DesktopClientSettings.test.ts`.
- Server `atomicWrite.test.ts` and `serverSettings.test.ts`.

Changed-file lint and formatting passed. Web, desktop and shared package typechecks passed. The final concurrent server package typecheck has no errors in this slice. It still reports other in-progress fixture issues in ProjectionControlReads, PullRequestWatchReactor, ThreadLaunchService and BitbucketApi; the primary agent owns their integrated acceptance. Local server-settings test errors were corrected.

Independent review found the shared database lock, scoped stale-operation retry, credential identity separation, bounded rejection backoff and typed transaction completion appropriate; its requested retry simplification was applied and regression-tested. The final independent source review reported no additional actionable finding or useful simplification. Earlier UI/desktop/parity edits were preserved throughout.
