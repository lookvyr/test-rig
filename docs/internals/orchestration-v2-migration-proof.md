# Orchestration V2 migration proof

LOO-17 proved a forward-only upgrade from Test Rig schema 39 into the pinned
upstream V2 event/projection stores in an isolated experiment on October 2, 2026.
The foundation now contains those adaptations and tests. LOO-22 retired the six
files under `scripts/orchestration-v2-proof` on October 4; this document preserves
the experiment's provenance and limits.

## Current verification

Run the integrated migration tests from `apps/server`:

```sh
../../node_modules/.bin/vp test run src/orchestration-v2/legacy/ForkMigration.test.ts
```

All six cases passed on October 4. They cover forward-only migrations, 130 imported
messages with exact IDs/roles/text/timestamps/attachments, unchanged historical
migration ledger rows, context handoff, interrupted-import restart, snapshot/WAL
failure handling, fork metadata, unchanged source data and production-layer reopen.
They use the actual runtime modules and repository dependencies.

The optional experiment-only comparison against an external database is superseded
by these assertions and the recorded [integrated copied-data acceptance](./orchestration-v2-nightly-sync.md#final-acceptance-pass-october-3-2026):
all six real messages and all 38 historical ledger entries were preserved, the
source hash stayed unchanged, and the imported Claude conversation resumed. That
is recorded earlier evidence, not a new native provider run during retirement.
No production legacy code or historical migration was removed.

## Historical command — retired

The following command is provenance only; its script is no longer in the checkout.
The experiment files remain in Git history at
`4e5fc7fa6d18af08d4f7b227cad57d502a7e25f3`. It required Node 24.18 or later,
Git, tar, npm, installed Test Rig dev dependencies, and a local upstream checkout
containing `de343914273eceb852a1d1d739cd1d38df7796ee`:

```sh
node scripts/orchestration-v2-proof/prepare.mjs /path/to/upstream /path/to/copied/state.sqlite
```

The optional argument contained the Test Rig migration-39 ledger. The harness
opened it read-only and used SQLite backup to create another temporary copy.
Without it, the synthetic cases ran and the copied-data case was skipped.
The application was never started against that source.

The runner exported pinned upstream source into a temporary directory, overlaid
Test Rig's historical migrations unchanged, applied `fork.patch`, installed locked
experiment dependencies with lifecycle scripts disabled, and ran a focused
TypeScript check and Node tests. This separate Effect installation was needed
before integration; the current runtime and tests use the repository installation.

## Historical adaptations under test

- Keep Test Rig migration IDs 1–39 and their names. Append 40 for the importer
  prerequisites, 41 for the V2 schema, and 42 for V2 indexes. These numbers were
  proposed before integration; current runtime migrations also include schema 43.
- Add the columns the actual importer reads. Do not replay upstream's conflicting
  migrations 38/39 or its migrations that clear project model defaults and
  rewrite settlement timestamps. Other feature-specific schema belongs to its
  owning integration ticket.
- Preserve `pullRequestAssociation` as an optional field in V2 thread records.
  Its linked reference and explicit unlinked state survive schema encoding and
  storage. PR detection and UI consumers must honor this field during foundation
  integration; retaining it alone does not implement those consumers.
- Exclude temporary side-chat rows from shell import and pending counts. Their
  original rows and parent IDs remain in the legacy tables; restarting does not
  turn them into durable chats.

The experiment used actual upstream importer, event sink, event store, projection
store, snapshot and context handoff modules. `fork.patch` carried their fork
adaptations, and `harness/migrations.mts` supplied the migration composition.
Both are superseded by the integrated runtime and its migration tests.

## Evidence and limits

On 2026-10-02, the proof used a consistent read-only backup of the existing
worktree database at Test Rig migration 39: **2 ordinary threads and 7 saved
messages**. All imported message IDs, roles, text, timestamps, and supported
attachments matched. The original copied database's SHA-256 remained unchanged,
and every historical migration ledger row remained identical.

Synthetic fixtures supplement that small real snapshot with 130 long messages,
an interrupted assistant message, supported image attachments, Codex/Claude/
OpenCode and unavailable provider selections, permission and interaction modes,
explicit PR link/unlink, pin/snooze/archive/settlement state, and temporary side
chats. Tests exercise partial transcript failure followed by a new importer
instance, idempotent restart, invalid snapshots, abandoned partial snapshots,
and committed versus uncommitted WAL data.

Imported threads have no native provider session or V2 checkpoints. Saved history
prepares a budgeted context handoff with retrieval references; a test delivery
callback verifies intact selected messages and delivery bookkeeping. This does
not prove a live provider continuation or executable retrieval tools. Those checks
require the foundation and client integration.

The database experiment leaves adjacent settings and scratch files untouched and
preserves project model defaults. It does not run the desktop shell or browser,
so Electron identity, browser drafts, attachment rendering, unavailable-provider
admission, and PR detection behavior still require integrated verification.
Original and V2 databases are separate after the initial snapshot; they are not
synchronized. Shared settings, assets, and workspaces are not isolated rollback
copies.

## Simplification review

A separate agent reviewed the completed experiment. Two unused schema additions
(project environment default and title state) were removed. The fixtures now
contain legacy sessions/checkpoints before asserting that V2 does not adopt them,
adjacent-file sentinels predate snapshot/migration, and the copied-data count
excludes temporary side-chat messages. The isolated source/dependency staging was retained until the application adopted
V2 and its Effect RC. LOO-22 removed it after confirming the replacement evidence
described above.
