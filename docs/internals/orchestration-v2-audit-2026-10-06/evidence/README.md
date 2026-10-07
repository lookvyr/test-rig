# Diagnostic evidence

These are the disposable diagnostics and command observations used by the October 6 audit. Sources are stored as `.txt` so normal test discovery cannot execute them. They are evidence, not installed regression tests or production changes.

Some tests require placement at the source-relative test path stated in their domain appendix; the standalone scripts point at the audited checkout and installed dependencies. Client/provider copied harnesses require a suitable Vitest/Vite+ config. Recreate only the relevant test in a disposable checkout when turning a finding into a repair. Do not run every diagnostic as a suite: several intentionally assert desired behavior and therefore fail on the audited revision.

- [ClaudeAdapterAudit.patch.txt](ClaudeAdapterAudit.patch.txt)
- [FastModeAudit.test.ts.txt](FastModeAudit.test.ts.txt)
- [client-residuals.test.ts.txt](client-residuals.test.ts.txt)
- [testrig-audit-pr-watch.mjs.txt](testrig-audit-pr-watch.mjs.txt)
- [testrig-audit-schedule-race.test.ts.txt](testrig-audit-schedule-race.test.ts.txt)
- [testrig-audit-workspace-repro.txt](testrig-audit-workspace-repro.txt)
- [testrig-runtime-agent-history-repro.test.ts.txt](testrig-runtime-agent-history-repro.test.ts.txt)
- [testrig-runtime-busy-stream-repro.mjs.txt](testrig-runtime-busy-stream-repro.mjs.txt)
- [testrig-runtime-delegated-recovery-repro.test.ts.txt](testrig-runtime-delegated-recovery-repro.test.ts.txt)
- [testrig-runtime-rpc-repro.mjs.txt](testrig-runtime-rpc-repro.mjs.txt)
- [testrig-runtime-sqlite-repro.mjs.txt](testrig-runtime-sqlite-repro.mjs.txt)
- [testrig-runtime-stop-repro.test.ts.txt](testrig-runtime-stop-repro.test.ts.txt)
- [testrig-runtime-worker-repro.mjs.txt](testrig-runtime-worker-repro.mjs.txt)

The Claude adapter record is a diff against the audited adapter unit-test file, avoiding duplication of the existing harness. It includes the disposable import-path adjustments used during the audit.
