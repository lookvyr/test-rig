# Provider reliability repairs — October 6, 2026

Implementation pass against the current shared Test Rig checkout. Revalidated the findings in `docs/internals/orchestration-v2-latest-audit.md`, its provider appendix, and the automatic-delivery/unattended-provider findings in the coordination appendix. Read `AGENTS.md`, `FORK.md`, and `.repos/effect-smol/LLMS.md` before the backend edits.

All provider/fixture items owned by this agent are implemented and pass the focused checks below. No application, dev server, or real provider CLI was launched by this agent. No commit, PR, Linear change, or live-state write was made. Existing UX repairs were preserved. The primary owns the final combined tests and live acceptance.

## Result and verification

**425 tests passed across ten scoped files** in the final provider batch, including all 13 OpenCode orchestrator cases and all four startup-history GC cases. Duration: 40.75 seconds. No timeout was increased and no polling or sleeps were added to production behavior or receipt-driven tests.

Command:

```sh
node_modules/.bin/vp test run \
  apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts \
  apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts \
  apps/server/src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts \
  apps/server/src/orchestration-v2/ClaudeAutomaticDelivery.integration.test.ts \
  apps/server/src/orchestration-v2/ProviderTurnStartService.memory.test.ts \
  apps/server/src/orchestration-v2/OpenCode2OrchestratorV2.integration.test.ts \
  apps/server/src/mcp/OrchestratorMcpService.test.ts \
  apps/server/src/claudeModelOptions.test.ts \
  apps/server/src/orchestration-v2/SteeringCompletion.integration.test.ts \
  packages/contracts/src/orchestrationV2.test.ts
```

Targeted lint completed with exit 0. Its four warnings are pre-existing unused imports/declarations in the large adapter and switch-test files. Log: `/private/tmp/reliability-providers-lint.log`.

The final server typecheck snapshot had no TypeScript errors: 261 Effect suggestions and one pre-existing `ws.ts` warning made that command exit 1. The primary subsequently reported that the transport owner fixed the warning and the final server typecheck now exits 0. This distinction is intentional; the older snapshot is `/private/tmp/reliability-providers-tsc-final.log`.

## Repairs

| Finding                                                                                                                 | Current repair                                                                                                                                                                                                                                                                                                                                                    | Focused proof                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude recovery chose resume from durable turn ordinals even when the replacement native session had never been created | Added optional `nativeThreadHasTurns` to adapter/execution input; calculate history for the actual current native identity in startup; pass it into Claude query creation. Explicit false overrides historical ordinals and historical fork lineage. A known current native fork still resumes its inherited history. Older callers retain ordinal/fork fallback. | Native identity tests cover ordinary first creation, persisted resume, known first-turn fork, durable ordinal 4 with fresh identity, accepted native history with ordinal 1, and replacement of a row that originally came from a fork. Provider-switch integration covers recovery into a fresh identity and legacy identity safeguards. |
| Omitted Normal and explicit Normal produced different Claude query identities                                           | Supported Fast-mode models now normalize omitted `fastMode` to false at the adapter boundary. Fast remains distinct. Models that do not expose the option are unchanged.                                                                                                                                                                                          | Compiler test compares omitted/false/true identities; the background-shell test proves omitted→explicit Normal reuses the existing query and preserves work while switching to Fast is rejected until background work ends.                                                                                                               |
| Automatic Claude delegated completion could use immediate native steering and cancel pending tools                      | Added optional `activeSteeringInterruptsTools` capability; Claude advertises true. The delegated-completion route queues for that capability. Explicit user steering remains available. Existing scheduled sends remain queue mode.                                                                                                                               | Three adapter/orchestrator/scheduler integration cases: automatic child completion and scheduled message preserve native pending tools; explicit user steering demonstrates native cancellation behavior. Existing steering-completion cases remain passing.                                                                              |
| Native canceled-tool results appeared failed/completed without their cancellation reason                                | Decode SDK `tool_result_meta` through a schema, preserve `toolNonExecutionKind`, and classify `cancelled` results as canceled. Added optional contract field with backward-compatible tests.                                                                                                                                                                      | Claude adapter tests cover cancellation/non-execution metadata and ordinary results; contract codec checks preserve optional fields.                                                                                                                                                                                                      |
| Unattended delegation rejected a provider repaired outside the app because its availability snapshot was stale          | Recheck an explicitly named or inherited enabled instance once on `provider_unavailable`, then resolve the same instance again. Do not probe disabled instances or providers without an orchestration adapter. Driver-only selection retains existing selection behavior; no silent replacement of explicit instances is introduced.                              | Explicit and inherited tests each show one failed probe without dispatch, then one successful probe/dispatch after repair. Existing disabled/unregistered adapter tests reject without a refresh implementation, proving the fail-closed paths do not probe.                                                                              |
| Codex child-model labels relied on legacy resume response shape                                                         | Try `thread/read` with `includeTurns:false`, validate native child identity and nonblank `thread.model`, then fall back to legacy `thread/resume` metadata. Preserve a model already learned from a native event.                                                                                                                                                 | Child metadata tests cover the new response, legacy fallback, invalid/missing read metadata, and native model precedence. Full Codex adapter suite passes.                                                                                                                                                                                |
| OpenCode fork/switch validation referenced missing recorded transcripts                                                 | Restored both captured native recordings. Adapted only the app-owned instructions key and MCP permission namespace/hash to Test Rig. Native captured responses and event sequences remain intact.                                                                                                                                                                 | Earlier-turn fork produces only the selected inherited response and the child response; plan→build/model switch occurs before the next prompt. Both restored cases and all 13 file cases pass.                                                                                                                                            |
| Startup-history retention fixture was missing                                                                           | Restored the isolated Node/GC fixture, removed the upstream managed-auth service dependency, and supplied valid local thread lifecycle fields. The restored assertions exposed a real retention bug rather than just a missing-file gap.                                                                                                                          | All four modes initially retained 2/4 historical payloads at the two checkpoints. After the loader-scope repair below, regular, handoff, handoff-compact and handoff-failure all retain zero while their run workers stay alive.                                                                                                          |

## Actual memory repair discovered by restored verification

The `loadSubagent` callback was created inside `ProviderTurnStartService.start`, alongside closures that used the startup projection and handoff history. Retained run inputs kept that shared lexical scope alive. The restored fixture therefore held every synthetic history payload even after startup delivery had completed.

Moved the loader factory outside the startup scope. Each produced loader closes over the provider instance id and service references, and continues to read current parent/child records when invoked. It does not retain the initial projection or transcript. This preserves native-child ownership and lazy recovery semantics while releasing startup payloads.

The four GC tests exercise normal startup and all handoff paths with live worker controls, including late current-state checks. The assertion remains zero retained history at two and four live runs; it was not relaxed.

## Owning source pointers

- `apps/server/src/claudeModelOptions.ts:41`: Normal/Fast normalization.
- `apps/server/src/orchestration-v2/ProviderAdapter.ts`: optional native history signal.
- `apps/server/src/orchestration-v2/RunExecutionService.ts`: narrow optional input and adapter-start forwarding; finalization/Stop changes belong to the runtime owner.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts:177`: loader factory outside startup scope; `:1252`: current native history proof, including current fork and legacy safeguards.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:202`: steering/tool cancellation capability; `:3703`/`:6055`: canceled result metadata; `:6923`: query creation/resume decision.
- `apps/server/src/orchestration-v2/Orchestrator.ts`: only the delegated-completion steering condition was changed by this agent; owning Stop/recovery edits belong to the runtime owner.
- `apps/server/src/mcp/OrchestratorMcpService.ts:914`: one-time refresh resolver, used by delegation and top-level creation. Later restart-result fencing edits belong to the runtime owner.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:1256`/`:2670`: reported child-thread model decoding/read-first fallback.
- `packages/contracts/src/orchestrationV2.ts:219`/`:1273`: optional capability and cancellation metadata.

Restored fixtures:

- `apps/server/src/orchestration-v2/testkit/fixtures/opencode2_fork/opencode_transcript.ndjson`
- `apps/server/src/orchestration-v2/testkit/fixtures/opencode2_switch/opencode_transcript.ndjson`
- `apps/server/src/orchestration-v2/testkit/ProviderTurnStartMemory.fixture.mjs`

The three restored files total roughly 78 KB. Their adapter testkit was used for temporary request-mismatch diagnostics and restored afterward; no diagnostic logging remains.

## Upstream references and adapted boundaries

Reviewed the exact locally available Git diffs before adoption:

- `efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448`: Claude native identity, Normal query reuse, and recovery tests. Adapted to Test Rig's existing durable-fork resume proof.
- `1beb0355d05bbe4a780b238e3138f0a8ed99df5f`: automatic delivery guard, cancellation metadata, contracts, deterministic pending-tool cancellation tests. Adapted tests to current Test Rig management/configuration/V2 database services; excluded managed-auth services were not restored.
- `cbb731beb36db2330c9a2632b11354315658ea21`: unattended provider refresh, with an additional no-probe gate for disabled or unregistered adapters.
- `eea9f7cfebbdb51d27f07a816119c71a67509997`: reported Codex child models; excluded-provider adapter changes were not ported.

No goals, managed authentication, interactive queues, rewind, merge-back, or raw tool-output presentation were added. Deferred notifications may queue internally; interactive follow-ups continue steering as Test Rig requires.

## Related ownership and remaining acceptance

- **Earlier accepted background work after a failed newer start:** transferred explicitly to the runtime owner, who owns the Stop fallback in the same Orchestrator region. This report does not independently certify their final Stop tests.
- **Composer styled-edge caret/typing repair:** the primary took ownership of `ComposerPromptEditor.tsx`, `composer-rich-text-doc.ts`, and their tests. This agent made no styled-edge changes during this reliability pass.
- **Final app/provider acceptance:** primary-owned. The 425 tests are deterministic adapter/replay/GC validation, not new live Claude/Codex/OpenCode CLI claims.

Additional unchanged test files recommended for the final manifest: `ProviderTurnStartService.test.ts`, `RunExecutionService.test.ts`, `ProviderAdapterRegistry.test.ts`, `NativeSubagentHistory.test.ts`; the unchanged `ProviderTurnStartService.memory.test.ts` and `OpenCode2OrchestratorV2.integration.test.ts` are already in the successful batch above.

No provider or fixture finding owned by this agent remains unresolved.

## Resumed ThreadFork fixture repair — October 7

Combined verification also included the unchanged `testkit/ThreadFork.integration.test.ts` and exposed two stale upstream tests that expected `checkpoint.rollback` to succeed. Test Rig correctly rejected both under its no-rewind contract. Neither production behavior nor the rejection guard was changed.

Both cases now prove retained durable-fork behavior:

- **Source independence:** archive the source after its native fork resolves. The source retains both completed Alpha/Beta turns; the fork stays unarchived with its own native identity and only the selected Alpha history. Archiving does not truncate either conversation or change the fork boundary.
- **Earlier local fork:** create a further durable fork from the first completed local run of an existing Claude fork, then dispatch to the new child. The replay verifies a second native `session.fork` from the existing fork's native id at the first local assistant UUID, followed by a query resuming the new native child. The original fork retains both completed local turns; the nested fork includes inherited source/first-local history and excludes the later local turn. Neither conversation has a rewind cursor.

Added `testkit/fixtures/thread_fork_native_fork_local_fork/claude_transcript.ndjson`, a 37-frame composition of the retained captured local-turn recording with an explicit second fork/new native id replacing resume-at-cursor. Metadata clearly labels it an adapted replay, not a new live recording. The captured continuation response is reused because its selected conversation boundary is the same. The old historical rollback recording remains available; this test no longer consumes it.

Verification:

- All **6/6 ThreadFork integration cases passed** in 6.13 seconds.
- Targeted lint passed without warnings.
- Focused Claude native-fork/session-identity checks passed **7/7 selected cases**; 132 unrelated adapter cases were outside the selected filter.
- Scoped server typecheck passed with exit 0 after the edits. Log: `/private/tmp/thread-fork-types.log`.

No ThreadFork cases were skipped, assertions were not weakened, no timeout was increased, and no app/provider process or project commit was created. The laptop-restart pause is lifted and the remaining ThreadFork TODO is resolved.
