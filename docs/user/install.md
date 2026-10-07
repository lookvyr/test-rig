# Install Test Rig

Test Rig is built and run from a source checkout. The desktop app starts the local server and uses the bundled web client for its UI.

## Requirements

- Node.js `^24.13.1`
- [Vite+](https://viteplus.dev/guide/)
- At least one installed and authenticated provider CLI

## Build from source

Test Rig does not publish an npm package or prebuilt releases. Install the requirements above,
then run the desktop app in development:

```bash
vp i
vp run dev:desktop
```

Build and run the production desktop app with:

```bash
vp run build:desktop
vp run start:desktop
```

To update, close the app, update your source checkout and dependencies, then build and start it again. Projects, conversations, and settings are stored separately in `~/.test-rig/userdata` by default, so rebuilding does not reset them. Keep the same `TEST_RIG_HOME` value if you use a custom state directory. Development mode normally uses `~/.test-rig/dev` instead.

On macOS, `vp run dist:desktop:dmg` creates a DMG in `./release`. See the maintainer
[scripts reference](../internals/scripts.md) for other platforms.

### Upgrading to Orchestrator V2

Before your first V2 launch, close Test Rig and copy its entire application home
(`~/.test-rig` by default) to a backup location. Keep the same `TEST_RIG_HOME` if
you use a custom home, then update dependencies and rebuild or install the new
desktop app.

The first V2 launch imports your existing conversations into a separate database
and preserves the original. Existing chats keep their saved history; continuing
one starts a fresh provider session with that history available. After the
upgrade, the old and new databases are not synchronized: an older app cannot
show work done in V2. Keep both databases. See the
[recovery guide](../operations/orchestration-v2-recovery.md) before restoring a
backup or returning to an older build.

## Providers

Test Rig drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider | CLI                                                   | Default binary |
| -------- | ----------------------------------------------------- | -------------- |
| Codex    | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        |
| Claude   | [Claude Code](https://claude.com/product/claude-code) | `claude`       |
| OpenCode | [OpenCode 2](./providers-opencode.md)                 | `opencode`     |

Run the login command on the machine running the Test Rig server, not on the device you browse
from.

### Binary discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Test Rig.

### When auth is needed

Provider auth is required before you start a session with that provider, not before you start
Test Rig. You can install Test Rig, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next steps

- [Permission modes](./permission-modes.md): how much Test Rig asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
