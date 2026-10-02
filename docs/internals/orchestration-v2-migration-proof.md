# Orchestration V2 migration proof

LOO-17 tests a forward-only upgrade from Test Rig schema 39 into the pinned
upstream V2 event/projection stores. This is an isolated experiment, not a change
to app startup. LOO-18 must integrate the proven adaptations, and LOO-22 must
verify them through the actual client and provider runtime.

## Run the proof

Requires Node 24.18 or later, Git, tar, npm, installed Test Rig dev dependencies,
and a local upstream checkout that
contains commit `de343914273eceb852a1d1d739cd1d38df7796ee`:

```sh
node scripts/orchestration-v2-proof/prepare.mjs /path/to/upstream /path/to/copied/state.sqlite
```

The optional database argument must contain the Test Rig migration-39 ledger.
The harness opens it read-only and uses SQLite backup to create another temporary
copy. Omitting it runs the synthetic tests and explicitly skips the copied-data
test. Never start the application against the source to run this proof.

The runner exports the pinned upstream source into a new temporary directory,
overlays Test Rig's historical migrations unchanged, applies `fork.patch`, installs
locked experiment dependencies with lifecycle scripts disabled, and invokes
a focused TypeScript check and Node's test runner. It prints and retains the experiment directory for inspection.
Each test deletes only its own temporary database directories. The experiment
uses upstream's Effect RC independently of Test Rig's existing Effect beta;
repository dependencies and lockfile are not changed.

## Adaptations under test

- Keep Test Rig migration IDs 1–39 and their names. Append 40 for the importer
  prerequisites, 41 for the V2 schema, and 42 for V2 indexes. These numbers are
  proposed for the integration branch, not yet registered in app startup.
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

The importer, event sink, event store, projection store, snapshot implementation,
and context handoff services are actual upstream modules. They are not replaced
with fake persistence or a second hand-written importer. `fork.patch` is the small
adaptation for those modules; `harness/migrations.mts` is the migration composition
to carry into LOO-18. The harness is disposable after those tests move into the
integrated runtime.

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
excludes temporary side-chat messages. The isolated source/dependency staging
remains because the production app has not adopted V2 or its Effect RC yet.
