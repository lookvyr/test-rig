# Install Sightseer

Sightseer is built and run from a source checkout. The desktop app starts the local server and uses the bundled web client for its UI.

## Requirements

- Node.js `^24.13.1`
- [Vite+](https://viteplus.dev/guide/)
- At least one installed and authenticated provider CLI

## Build from source

Sightseer does not publish an npm package or prebuilt releases. Install the requirements above,
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

On macOS, `vp run dist:desktop:dmg` creates a DMG in `./release`. See the maintainer
[scripts reference](../internals/scripts.md) for other platforms.

## Providers

Sightseer drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider | CLI                                                   | Default binary |
| -------- | ----------------------------------------------------- | -------------- |
| Codex    | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        |
| Claude   | [Claude Code](https://claude.com/product/claude-code) | `claude`       |
| OpenCode | [OpenCode](https://opencode.ai)                       | `opencode`     |

Run the login command on the machine running the Sightseer server, not on the device you browse
from.

### Binary discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Sightseer.

### When auth is needed

Provider auth is required before you start a session with that provider, not before you start
Sightseer. You can install Sightseer, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next steps

- [Permission modes](./permission-modes.md): how much Sightseer asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
