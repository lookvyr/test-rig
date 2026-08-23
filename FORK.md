# Sightseer Fork Boundary

## Product definition

Sightseer is a single-user, local-first desktop application that provides a UI
over approved coding harnesses: Codex, Claude Code, and OpenCode. It removes
unneeded cloud services and providers while retaining enough of T3 Code's local
core to adopt, adapt, or learn from valuable upstream work selectively. Full
upstream parity is not a goal.

This document defines the stable product boundary. It is not a claim that every
exclusion has already been removed from the pinned baseline, and it is not a
work backlog. Linear owns actionable work and current status.

## Upstream baseline and relationship

Sightseer began from T3 Code release tag `v0.0.32`, commit
`239ef1c54df2f657912ccb5b8e25193d49d90417`, with its full history preserved.

Sightseer is upstream-aware, not upstream-compatible at all costs. It stays
close to T3 Code in the local core and may diverge confidently at product
edges. Stable release tags are the preferred intake points; daily merges from
upstream's main branch and isolated UI cherry-picks are not the default.

For each cohesive upstream change, Sightseer may choose one of three paths:

- **Direct port:** apply the change substantially as upstream shipped it when
  its behavior and dependencies fit this boundary.
- **Adapted port:** preserve the useful behavior while changing its interfaces,
  dependencies, or presentation to fit Sightseer.
- **Independent implementation:** use upstream as a design reference, or do not
  use it, when a Sightseer-native solution is smaller or clearer.

Ports should include the relevant contracts, tests, and migrations rather than
only their visible UI. Historical migrations are preserved and are never
rewritten or renumbered. Bidirectional database compatibility with stock T3
Code is not a goal.

## Retained local product

The desktop application is the primary product surface. `apps/web` remains
because it is the desktop renderer. The loopback server remains an
authenticated local backend, not merely a UI helper: it owns threads,
orchestration, provider processes, terminals, filesystem access, Git workflows,
and project state.

Sightseer supports these executable providers:

- Codex
- Claude Code
- OpenCode

The local product also retains terminals, filesystem operations, Git workflows,
source-control hosting integrations, worktrees and checkpoints, project scripts,
permission-mode selection, browser and MCP integrations, local secrets, and
resource diagnostics. GitHub integration is enabled by default. GitLab, Azure
DevOps, and Bitbucket integrations may be explicitly enabled by the user.
Disabled source-control hosting integrations must have no reachable discovery,
authentication, enrichment, or operation path. This integration boundary does
not restrict explicit generic Git operations against user-configured remotes.
Approved provider harnesses, explicit Git actions, enabled source-control hosting
integrations, browser/MCP tools, and other explicit user-directed actions may use
the network.

## Architecture to protect

Selective simplification must preserve these seams unless a later explicit
decision replaces them:

- The provider-driver abstraction and approved provider adapters.
- Effect/RPC contracts shared across process boundaries.
- Event-sourced orchestration, including provider-neutral command, event,
  projection, reactor, and receipt semantics.
- Provider-neutral checkpoint and worktree behavior.
- The client runtime shared by applicable clients.
- The desktop shell, web renderer, and local server process boundaries.
- Database history and migrations, including readable legacy rows and provider
  slugs that must fail closed when their provider is unavailable.
- Existing local secrets and authentication architecture, which also supports
  session signing, asset signing, and approved provider secrets.
- Generic local connection and authentication abstractions needed by the local
  product.

Complexity that is specific to a provider belongs at its adapter boundary. An
excluded system should be removed as a narrow vertical slice and verified
before another slice is removed; shared local infrastructure must not be
deleted merely because a cloud feature also consumes it.

## Excluded product edges

The following are outside Sightseer's product boundary:

- T3 Connect, including its server routes, lifecycle, UI, and packaging.
- Clerk account flows. Electron responsibilities currently coupled to Clerk,
  such as single-instance and second-instance handling, must remain locally
  owned when Clerk is removed.
- Managed relay and cloudflared infrastructure, mobile push, and Tailscale
  integration.
- Cursor and Grok coding-harness providers. Exclusion applies to executable
  server registration and selectable UI, not merely visual hiding; unrelated
  editor integration is a separate concern.
- PostHog analytics and identity collection, and outbound OTLP export.
- Hosted/public web deployment and the mobile and marketing surfaces and build
  targets.
- Inherited CI, release, and publication automation, including GitHub Actions,
  npm publication, GitHub Releases, release notifications, and automated
  version commits. Package-backed server installation and self-update are also
  excluded from the source-only product.
- Usage/pricing UI and custom-gateway usage integration.
- Upstream desktop auto-update feeds.

Automatic ancillary requests to PostHog, OTLP collectors, upstream desktop
update feeds, LiteLLM pricing tables, Google favicon services, and npm-registry
provider enrichment are hard-disabled. This does not prohibit user-triggered
provider maintenance or other explicit network actions through retained local
capabilities. Local NDJSON observability and local resource diagnostics remain.

An exclusion must be enforced at the owning server, process, or packaging
boundary. Missing configuration or hidden UI is not sufficient when a route,
lifecycle, executable provider, or outbound client remains reachable.

## Deferred decisions

- SSH connectivity is acceptable but deferred until a concrete need follows
  the local baseline.
- ACP may remain temporarily dormant and unreachable. With Cursor and Grok
  removed it has no independent route or registration path; deletion waits for
  dependency analysis.

Deferred does not mean prohibited. Adding one of these capabilities requires a
new explicit boundary decision before implementation.

## Independent identity and state

Sightseer's identity is independent of T3 Code:

- Product name: Sightseer
- Bundle/application ID: `com.lookvyr.sightseer`
- Production state root: `~/.sightseer`
- State override: `SIGHTSEER_HOME`
- URL schemes: `sightseer://` and `sightseer-dev://`

Sightseer must ignore ambient `T3CODE_HOME` and must not fall back to T3 legacy
paths. Its Electron profile, caches, logs, browser partitions, updater state,
database, worktrees, and runtime directories are Sightseer-specific so both
applications can run concurrently without collisions. Provider-owned Codex,
Claude Code, and OpenCode authentication homes remain intentionally shared.

## Decision log

| Decision                             | Rationale                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop-first and local-first        | The desktop workflow is the product; the web code is retained as its renderer and the authenticated loopback server owns the local core.                                            |
| Three approved providers             | Codex, Claude Code, and OpenCode cover the intended harnesses without retaining unused executable integrations.                                                                     |
| Explicit source-control integrations | GitHub is enabled by default; GitLab, Azure DevOps, and Bitbucket are opt-in and fail closed while disabled. Generic Git remains independent of hosting-provider integration state. |
| Remove cloud product edges           | A personally owned tool used with company repositories must not make data egress to unapproved services accidentally enableable.                                                    |
| Build and verify from source         | Local build, test, and desktop artifact commands remain; inherited CI and publication automation do not. Future automation will be purpose-built.                                   |
| Preserve architectural seams         | Contracts, orchestration, drivers, checkpoints, client runtime, migrations, and local auth make the local product coherent and keep valuable upstream work portable.                |
| Selective upstream intake            | Direct, adapted, and independent implementations are all valid; product fit matters more than complete parity.                                                                      |
| Independent state identity           | Sightseer and T3 Code must coexist without sharing application state, while provider-owned authentication remains reusable.                                                         |

## Boundary smoke tests

Use the smallest focused checks appropriate to a changed vertical slice:

- [ ] The desktop shell starts with the local web renderer and a loopback-bound,
      authenticated server.
- [ ] A disposable repository can create and resume a thread, run terminal and
      filesystem operations, use Git, and create and restore a checkpoint/worktree.
- [ ] Codex, Claude Code, and OpenCode can each be selected and complete a
      representative local turn with their existing provider-owned authentication.
- [ ] Cursor and Grok cannot be selected or executed through UI, RPC, persisted
      legacy configuration, or direct server requests; legacy data remains
      readable and fails closed.
- [ ] T3 Connect, Clerk account flows, relay/cloudflared, mobile push, and
      Tailscale have no reachable server lifecycle or route and no shipped client
      entry point.
- [ ] With automatic egress monitored or denied, startup and an idle session
      make no request to PostHog, OTLP, update feeds, LiteLLM pricing, Google
      favicons, or npm-registry enrichment.
- [ ] Local NDJSON observability, resource diagnostics, browser/MCP actions,
      explicit Git actions, enabled source-control hosting integrations, and approved
      provider networking still work; disabled hosting integrations make no
      discovery, authentication, enrichment, or operation request.
- [ ] `SIGHTSEER_HOME` and `~/.sightseer` contain Sightseer state; ambient
      `T3CODE_HOME` is ignored; T3 Code and Sightseer can run concurrently without
      Electron, port, URL-scheme, database, worktree, cache, or log collisions.
- [ ] A database carrying historical migrations and excluded-provider rows
      upgrades without rewriting history or corrupting unavailable settings.
- [ ] Focused desktop, server, web-renderer, contract, and provider tests pass
      for the boundaries touched by the change.
- [ ] No inherited GitHub Actions workflow or npm/GitHub release publisher is
      present, and no package-backed service install or self-update is reachable;
      local source builds and desktop artifact generation still work.

## License and attribution

Sightseer is derived from T3 Code, which is licensed under the MIT License and
copyright T3 Tools Inc. The repository's `LICENSE` file is authoritative and
its copyright and permission notice must remain included in copies or
substantial portions of the upstream software. Existing third-party notices
and attribution must also be preserved when their covered code remains.
