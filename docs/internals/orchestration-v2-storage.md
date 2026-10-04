# Orchestration V2 storage foundation

> Historical staged implementation. The [nightly integration](./orchestration-v2-nightly-sync.md)
> supersedes the runtime, adapter, dependency, and verification descriptions below.

LOO-19 adds the V2 storage and durable-effect services on `codex/orchestration-v2`.
This document records that staged foundation. LOO-21 now activates it; see
[the runtime cutover](./orchestration-v2-cutover.md) for the current application path.

The port is based on upstream `de343914273eceb852a1d1d739cd1d38df7796ee`.
It uses Test Rig's existing Effect version and Node SQLite client; it does not
upgrade dependencies or register additional providers.

## Persistence boundary

`makeV2SqlitePersistenceLive(stateDirectory)` opens `statev2.sqlite`. On first use,
`initializeV2Database` takes a consistent SQLite backup of the sibling
`state.sqlite`, publishes the complete snapshot without replacing an existing V2
database, and leaves the original database's migration ledger intact. An existing
V2 snapshot is reused. The databases are not synchronized afterward.

`V2Migrations.ts` retains Test Rig migrations 1–39 and adds forward migrations:

- 40 supplies the legacy columns needed by the importer, without changing the
  historical side-chat and PR-association migrations.
- 41 creates the V2 event/projection/effect schema and application event sequence.
- 42 supplies projection lookup indexes.

The original `Migrations.ts` and active SQLite layer are unchanged. The production
V2 layer must be selected only as part of the later cutover. The separate V2 event
and receipt service identities also avoid replacing V1 services during staging.

## Transaction and recovery behavior

`EventSink` commits events, projections, command receipts, and effect intent in one
SQL transaction. Duplicate commands return their original receipt and committed
events. Availability notifications follow the commit.

`EffectOutbox` and `EffectWorker` retain lease-owner checks, per-thread execution
lanes, cancellation registration before the final durable cancellation check, and
deadline-driven retries. Work classified as process-bound is not reclaimed merely
because a lease expires, or replayed after restart as if it were safe cleanup.
Replay-safe effects can be recovered. This is not an exactly-once guarantee for
arbitrary provider or tool operations; the provider executor is not connected yet.

Projection verification uses the created-thread index and stored schema/sequence
metadata. Rebuild reads 500-event pages inside a transaction and rolls back on a
failed page. Runtime recovery selects unfinished work and the latest relevant run
without decoding completed transcript bodies. Event compaction and scheduling
schema changes are deliberately absent from this slice.

## Fork adaptations and remaining integration

The basic legacy importer retains text, supported attachments, selected models
and modes, timestamps, archive/settlement/snooze/pin metadata, and explicit PR
association choices. Temporary legacy side chats remain legacy-only. Old native
sessions and checkpoint operations are not reconstructed. The context handoff
prepares budgeted saved messages and retrieval references for a fresh session.

New V2 thread details and shells carry `sideOfThreadId` and the fork's explicit
linked/unlinked PR association through persistence and rebuild. Project storage
uses Test Rig's existing project fields. These data paths do not yet implement
side-chat creation/disposal, busy-parent forks, workspace preparation, PR discovery
gates, or cleanup ownership; their runtime/client consumers remain acceptance
work for the foundation integration.

The imported wire projection currently provides upstream's compact transport
shape. It is not wired to the client, and does not resolve LOO-13's pending choice
about on-demand raw tool/command output. The October 4 product decision replaces
LOO-25's conversation-only rewind with forking. New rollback commands and old
queued rollback effects are rejected without changing provider context or files.
Historical rollback events remain readable; checkpoint capture and diffs remain.

## Verification

Focused server tests cover atomic rollback, command replay, stream races and
buffer bounds, worker fault settlement, cancellation, expired leases, restart
classification, retry deadlines, indexed recovery, paged rebuild failure, and
side ownership/PR metadata. Concurrency tests use completion signals and the test
clock rather than wall-clock sleeps or state polling.

`legacy/ForkMigration.test.ts` runs the LOO-17 synthetic migration cases against
the actual ported modules: long transcripts, attachment/context preparation,
interrupted-import restart, partial/failed copies, committed WAL contents,
fork metadata, original database preservation, and production-layer reopen.
The earlier real-data proof remains documented in
`orchestration-v2-migration-proof.md`; the temporary upstream proof harness is
retained until the full foundation consumes its handoff.

Seven contract tests cover historical JSON defaults and old/new notification
round-trips on the existing Effect release. Ten shared-helper tests cover bounded
tool-output metadata. Existing V1 event-store and side-chat migration tests pass.
Server, contracts, and shared package typechecks and targeted format/lint pass.

The isolated web smoke check paired successfully, opened a no-project draft, and
retained its text, model, and Auto mode through reload. Read-only inspection
confirmed schema 39, no V2 tables, and no `statev2.sqlite` in that test home. This
checks the unchanged application path; it does not verify live V2 provider
continuation or desktop IPC.

An independent simplification review found no remaining storage correctness
blocker. Its recommendations removed unused compaction and scheduling setup and
added focused schema compatibility coverage.

Run the focused checks from the corresponding package directories:

```sh
# apps/server
../../node_modules/.bin/vp test run src/orchestration-v2/FoundationPersistence.test.ts src/orchestration-v2/EffectWorker.test.ts src/orchestration-v2/legacy/ForkMigration.test.ts src/persistence/Layers/OrchestrationEventStore.test.ts src/persistence/Migrations/038_ProjectionThreadSideChats.test.ts

# packages/contracts
../../node_modules/.bin/vp test run src/orchestrationV2.test.ts

# packages/shared
../../node_modules/.bin/vp test run src/toolOutput.test.ts
```
