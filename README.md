# Sightseer

Sightseer is a single-user, local-first desktop control surface for coding agents. Its Electron app runs an authenticated local server and renders the bundled web client.

Works with your subscriptions on Claude Code, Codex, and OpenCode. If they're set up on your computer, Sightseer can control them.

## "Wait, what are you selling me?"

Nothing. We built Sightseer because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> Sightseer currently supports Codex, Claude, and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Build from source

Sightseer does not publish an npm package or prebuilt releases. Install Node.js
24 and [Vite+](https://viteplus.dev/guide/), then build or run it from this
checkout:

```bash
vp i
vp run dev:desktop
```

For a production desktop build:

```bash
vp run build:desktop
vp run start:desktop
```

To create a local installer, use the matching `dist:desktop:*` command. For
example, on macOS:

```bash
vp run dist:desktop:dmg
```

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

Sightseer uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
