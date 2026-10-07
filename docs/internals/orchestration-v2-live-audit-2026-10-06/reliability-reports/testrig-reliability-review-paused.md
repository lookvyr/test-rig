# Reliability review paused for laptop restart

The user explicitly paused all checks and review before restarting the laptop. Saved status only; no additional code inspection, test run or app/server/provider launch was performed after the pause instruction.

## Existing artifacts

- Initial reliability inventory and scope decisions: `/private/tmp/testrig-reliability-review.md`.
- Completed preceding live-parity source review, including native-browser follow-up: `/private/tmp/testrig-parity-implementation-review.md`.
- Owner reliability reports already received: `/private/tmp/testrig-reliability-{client,storage,transport,git,coordination,providers}.md` and primary report.

The reliability inventory identifies R01–R33 and their owners. It is an initial checklist, not final integrated clearance. A restored GC fixture subsequently exposed an additional genuine startup-history retention defect; that should be recorded as R34 in the eventual final inventory.

## Review completed before pause

- **Client R23/R24/R26:** stable source reviewed clear. IndexedDB retry was simplified to catch only the initial operation, eliminating the artificial Symbol error marker while retaining exactly one stale-handle reopen. Handle acquisition/close/versionchange/abort completion, secondary endpoint versus token identity and retained drafts, bounded rejection backoff, and symlink-preserving writers/target watch all have concrete constraints. Native transient retry is a selected bounded resilience addition, not a previously proven universal startup outage. Owner reported 98 tests in eight files, plus scoped typechecks.
- **Primary R32/R33 and styled caret edges R25:** reviewed the final narrow contract representation adaptation. The initial upstream-style helper failed the installed rc115 JSON/RPC wrapper; final source retains the original outer UnknownArray wire boundary around element decode/encode tolerance and hole guard. Actual config RPC/session and actual message.dispatch sibling-record tests replace reliance on isolated generic arrays. Explicit DateTimeUtcFromString/FiniteFromString codecs work; no broad unknown-union family, generic native-DateTime JSON framework or additional dependency patch was added. The small stored-mark caret helper avoids upstream marker decoration machinery absent from Test Rig. Primary reported 126 tests in seven files and later live styled-boundary success.
- **Coordination R11–R15:** source reviewed without an actionable issue. Scheduler guards missed-run writes against saved row identity. PR edits/paginated tails/required gate growth retain correct watermarks; rate pauses preserve monitor failure budget and forced-refresh generation. Settled-watch pause and existing cadence remain. Owner reported 446 tests in fourteen suites; test totals overlap other batches and must not be summed.
- **Git/workspace R16–R22:** substantial stable source reviewed. Temporary commit index/split-index/merge state preservation, stage-only-at-commit, optional lock suppression, shared submodule settings owner, explicit clone option terminator, explicit Bitbucket locator rejection and origin-aware grouping fit scope. Automatic namespace fallback is gated on an omitted user branch, preserving exact requests. One minor suggestion was sent: remove the new unreachable fallback around projectSettingsFor if its inferred error is never. This was a simplification suggestion, not a demonstrated production defect. Owner reported 341 tests in nine suites.
- **Foundation R27/R28:** source and owner report reviewed. Worker containment/accounting stays inside the existing helper; both SQLite copies reserve writable locks and preserve readonly behavior. Second-writer exposure and synchronous contention limits remain explicit. Owner reported nineteen tests in three files.
- **Transport R29–R31:** package patch and owner report reviewed. RPC defect isolation uses current rc115 options; stream shutdown and declared MCP error flags are patched in both source and distributed package files. Installed patch/hash and actual RPC/toolkit boundaries require final integrated validation. The primary's final context/RPC helper repair supersedes the transport report's earlier pending-config-test caveat.
- **Runtime R01–R05 and providers R06–R10:** final source review was in progress. Read owning Stop repair, guarded terminal events/checkpoint effects, app-owned recovery exemptions, durable continuation/result holds, receipt-based bounded Stop grace, SQL/memory/helper paging, current-native Claude resume history, Fast identity normalization, automatic mailbox guard, Codex child metadata read/fallback and one-instance availability refresh. No concrete new source defect was established in that inspection, but final integrated clearance was not issued.
- **New R34 memory defect:** provider report states restoring the missing GC fixture exposed retention of two/four historical payloads. The loader factory was moved outside startup scope so retained loaders capture only instance ID/service references and load current child records lazily. Four unchanged zero-retention assertions now pass. This is a genuine fixed bug discovered by restored validation, not merely fixture repair. The reviewer inspected the narrow factory extraction; full final inventory closure remains pending.

## Concrete unresolved verification at pause

Primary reports combined server batch: **55 files, 1,571 passed, three failed**.

1. Two unchanged ThreadFork replay expectations still expect excluded checkpoint.rollback. The provider/composer owner was adapting them to assert rejection and retained native fork semantics. These are stale-policy expectations, not authorization to restore rewind/checkpoint restoration. Final adapted test results were not received before pause.
2. The first runtimeLayer case times out around production run-service refresh/checkpoint completion. This needs investigation after restart. It must not be dismissed as an environment issue or declared fixed without evidence. The reviewer did not inspect or reproduce this failure after the pause instruction.

Primary had reported scoped server typecheck exit0, client combined 642 tests/54 files plus five scoped typechecks, and native/web styled-boundary and a fresh Codex turn/paused automation success. These are primary/owner outcomes, not independent reviewer runs. Final overall verification is incomplete.

## Items to finish after explicit resume

1. Verify the preserved working tree and resumed process state without restarting completed work blindly.
2. Resolve the runtimeLayer refresh/checkpoint timeout and confirm the two policy-correct fork tests pass.
3. Complete final runtime/provider source review and obtain their stable test reports, including restart/Stop ownership, atomic checkpoint effects, continued child-result delivery and fixture/GC closure.
4. Add R34 and a concrete closed/rejected/optional disposition for every R01–R33 row in the final review; keep performance-only and deliberate policy differences separate.
5. Review any new fixes from the failure investigation for correctness and simplification, then let the primary complete the final affected native/web acceptance.

No final all-known-bugs completion claim is supported at this paused point. Review remains paused until the user resumes.
