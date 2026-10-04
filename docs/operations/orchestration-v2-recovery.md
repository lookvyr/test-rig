# Recovering local orchestration state

The active engine uses `statev2.sqlite` in its configured state directory.
Production defaults to `~/.test-rig/userdata`; development or test instances can
select a different home or use the `dev` state directory. Confirm the instance's
configured home and state directory before copying or restoring anything.

## Make a recoverable copy

1. Stop the desktop app and any server using that home. Keep provider work stopped
   during recovery; a database backup does not capture a running process. Before
   making a recovery copy, turn off `continueThreadsAfterServerUpdate` globally
   and in any project overrides if it was enabled.
2. Copy the entire home to a separate backup directory. Preserve any SQLite
   `-wal` and `-shm` siblings with their database files. Do not copy individual
   database files from a running instance; use SQLite's consistent backup API
   when a live database snapshot is necessary.
3. Keep the original backup untouched. Test a recovery from another copy, using
   an explicitly isolated home and disposable project checkouts if provider work
   will run. Project paths stored in a copied database still point at their
   original checkouts.

The application home contains settings, local secrets and other state beyond
SQLite. Provider-owned authentication/session homes, the Electron profile or
browser's local drafts, and repository files are separate; copying the database
does not back them up. Protect backup files like the original local state.

## Restore a V2 backup

With every instance using the target home stopped, preserve the failed home
under a different name, then restore a complete, consistent backup into the
target location. Do not mix a restored database with WAL files from another
snapshot. Start one instance against the restored home and inspect its projects,
history and settings before continuing provider work.

Startup reconciles unfinished process-bound work; it does not recreate the old
provider processes. Automatic continuation is off by default, but a restored
`continueThreadsAfterServerUpdate` setting or project override can start new
provider work. Check that it is disabled in the recovery copy before its first
boot if you need to inspect without execution. Temporary side chats expire at
startup. Repository files are not restored from conversation checkpoints:
inspect their actual Git state separately.

V2 clients and servers use orchestration protocol version 2. Restore and run a
matching application build; an older client is not a recovery viewer for the V2
database.

## Understand the first V2 import

When `statev2.sqlite` is absent, startup takes a consistent SQLite backup of the
sibling `state.sqlite` and publishes the complete snapshot without replacing an
existing V2 database. Import and forward migrations operate on that copy. The
original V1 database and its migration ledger remain unchanged.

Once V2 exists, it is reused. The two databases are not synchronized. Removing
V2 to repeat import, or running an older engine against V1, loses access to all
work recorded only in V2. Preserve both databases and diagnose the failure
before considering that recovery route. A complete pre-cutover backup can
restore the pre-cutover state, but cannot recover later V2 work into V1.

For implementation and acceptance evidence, see the
[nightly integration](../internals/orchestration-v2-nightly-sync.md) and
[preservation audit](../internals/orchestration-v2-preservation-audit.md).
