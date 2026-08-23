# Test Rig

Test Rig is a local-first fork of [T3 Code](https://github.com/pingdotgg/t3code). It keeps T3 Code's desktop app, web client, local server, and coding-agent workflow, but cuts the product down to a narrower job.

This is mostly an experiment to try out a "control plane" harness and make some small tweaks along the way.

Test Rig runs coding tools that are already installed and authenticated on your machine. It does not include T3 Code's hosted services, analytics, mobile app, public web deployment, release pipeline, or self-update system. [FORK.md](./FORK.md) defines the exact product boundary.

## Supported providers

Test Rig supports three coding tools:

| Provider    | Install                                               |
| ----------- | ----------------------------------------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)  |
| Claude Code | [Claude Code](https://claude.com/product/claude-code) |
| OpenCode    | [OpenCode](https://opencode.ai)                       |

## Build from source

Building the app requires Node.js 24 and [Vite+](https://viteplus.dev/guide/).

Install dependencies and run the desktop app in development:

```bash
vp i
vp run dev:desktop
```

Build and run the production desktop app:

```bash
vp run build:desktop
vp run start:desktop
```

On macOS, build a DMG in `./release`:

```bash
vp run dist:desktop:dmg
```

## Documentation

Start with the [documentation index](./docs/README.md). Most pages began as T3 Code docs. Treat them as reference material for now. Some still use upstream names or describe retained internals. When the docs disagree with [FORK.md](./FORK.md), the fork boundary wins.

Useful references:

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control integrations](./docs/user/source-control.md)
- Provider setup for [Codex](./docs/user/providers-codex.md) and [Claude Code](./docs/user/providers-claude.md)
- [Architecture overview](./docs/internals/overview.md)

## Upstream and license

Test Rig began from T3 Code `v0.0.32` and keeps the full Git history. See [FORK.md](./FORK.md) for the upstream relationship and [LICENSE](./LICENSE) for license and attribution details.
