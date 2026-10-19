# Local database storage

Settings → Diagnostics shows the current database size and unused pages. SQLite
can reuse those pages; they do not mean that conversations are missing. A notice
appears when at least 1 GiB could be returned to disk.

Copy the inspect command and run it on the machine hosting the environment. It
names that environment's exact database. Inspection is read-only, including when
the app is running. It checks SQLite integrity and conversation projections.

To reclaim space, quit the desktop app and stop any servers using that database,
then run the same command with `--fix`. The doctor refuses exclusive access while
the database is in use. It never stops an app or service for you. `--dry-run`
always overrides `--fix`.

Maintenance first saves a complete backup beside the database in its `.backups`
directory. It removes superseded events, rebuilds conversation projections, and
compares them to the original state before reclaiming unused space. If replay
changes the projected state, that transaction is rolled back. Invalid projections
are reported rather than repaired automatically.

Keep the printed backup path until you have verified your conversations. Backups
are never deleted automatically, and maintenance needs temporary space for the
backup and SQLite's file rebuild. If disk reclamation fails after verification,
the database remains usable and the backup is retained.

For recovery, stop the app and preserve the current database and any `-wal` and
`-shm` siblings together before restoring a backup. Inspect a copy of the backup
first. Never replace a database while it is open, or combine a backup with the
failed database's WAL files.

After a V1 upgrade, `state.sqlite` is kept beside `statev2.sqlite` for rollback.
Doctor reports this copy but `--fix` never deletes it. To permanently remove it,
stop every Test Rig version and run the inspect command with
`--remove-legacy-database`. `--dry-run` overrides this flag too. Deletion is
separate from compaction and does not create another rollback copy.

Removal requires a valid current database, exclusive access to both databases,
and matching legacy conversation, project, session, pull request, and checkpoint
source rows in the current database. A newer V1 conversation or an incomplete
migration blocks deletion. Only the recognized sibling `state.sqlite` and its
WAL/SHM files are removed; current conversations, lazy transcript sources,
checkpoint history, and existing backups remain. An older V1 app would then
start without the deleted copy's conversations or settings.

V2 upgrades discard copied V1 activity, proposed-plan, pending-approval, and
projector bookkeeping tables that the current app does not read. Legacy
transcript sources and checkpoint metadata/diffs remain. This frees reusable
pages; run offline compaction to return them to disk.
