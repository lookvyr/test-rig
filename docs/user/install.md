# Install Sightseer

Sightseer is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the Sightseer server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

```bash
npx @lookvyr/sightseer@latest
```

This starts the Sightseer server on your machine and opens the local web app. Use
`npx @lookvyr/sightseer@latest --help` for the full CLI reference.

## Desktop App

Prebuilt desktop artifacts, when published, will appear on
[Sightseer GitHub Releases](https://github.com/lookvyr/sightseer/releases). The upstream T3 Code
Winget, Homebrew, and AUR packages do not install Sightseer.

## Providers

Sightseer drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
Sightseer looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the Sightseer server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Sightseer.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
Sightseer. You can install Sightseer, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much Sightseer asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping Sightseer in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
