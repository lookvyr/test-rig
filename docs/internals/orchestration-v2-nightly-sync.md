# Orchestrator V2 nightly sync

Status: implementation and scoped acceptance verification complete against the
pinned nightly below, including a free-model OpenCode turn and reload/resume. This supersedes the earlier
LOO-19/20/21 staged implementation and its older provider bridge.

## Source and scope

The source is T3 Code nightly `v0.0.46-nightly.20261003.2632`, commit
`f391794a35c604d57e166a3ab48d56fc6e4e469a`, published October 3, 2026.
The previous reference was `de343914273eceb852a1d1d739cd1d38df7796ee`.

Use upstream implementations by default for Orchestrator V2, its Codex, Claude,
and OpenCode 2 adapters, contracts, persistence, recovery, bounded transport,
client state, and related conversation/subagent presentation. Include dependencies
needed to make those implementations work; schema presence alone is not support.
The current Agents panel is not a preservation requirement. Adopt upstream's
child-conversation navigation, model reporting, result previews, and lifecycle.

Unrelated product work is outside this sync. FORK.md continues to control local
identity, authentication, data, allowed providers, source-control integration
gates, and excluded cloud, relay, telemetry, distribution, and pricing services.
Bring concrete conflicts with that boundary to the developer before resolving them.

## Preserve Test Rig additions

The developer confirmed preserving Test Rig-added features on top of upstream V2,
including rich Markdown composition and drafts, temporary side chats, whole-thread
Find, and explicit PR link/unlink controls. Existing diff/review presentation,
projectless scratch workspaces, worktree cleanup safeguards, browser behavior,
and keyboard/focus improvements also remain preservation requirements. Consult
the developer when a specific conflict arises rather than silently changing the
feature or retaining an obsolete implementation to avoid the conflict.

## Integration sequence

1. Pin source, inventory dependency and product differences, and preserve the
   current working state in an isolated worktree.
2. Align runtime dependencies and V2 contracts while preserving historical
   migrations and the Test Rig-specific persisted fields.
3. Integrate upstream's provider adapters and their lifecycle/replay tests.
4. Integrate the upstream orchestration services, recovery, and transport.
5. Integrate the related client state, timeline, and subagent conversation UI;
   adapt preserved Test Rig features at their owning boundaries.
6. Run focused provider/runtime/history/client checks and isolated desktop
   verification, including late completion events and real subagent follow-ups.
7. Review the integrated result, document remaining limitations, and return the
   verified changes to the development checkout without overwriting other work.

The developer released the original manual-test desktop environment on October 3,
and its tracked dev session was stopped. Continue verification in the isolated
nightly environment. Do not commit, push, or open a PR without the developer's instruction.

## Concrete regressions to cover

- A Codex `subAgentActivity` with kind `completed` arriving after idle or
  turn completion must not reactivate the child or its parent's working status.
- A genuine later child turn must reactivate that same child identity.
- Child model changes and completed answers must reach the visible child
  conversation and parent preview rather than becoming generic activity labels.
- Desktop HTTP preflight must allow the V2 protocol header.
- Side-chat availability requires a completed context boundary; selecting
  `/side` focuses the side composer after preparation, including existing panels.

## Accepted boundary decision

Upstream's provider setup includes managed Codex sign-in/installation and remote
model-discovery plumbing. The developer confirmed retaining Test Rig's native CLI
setup and omitting the managed-provider paths for this sync.

The follow-up prompt scrolling behavior uses the pinned nightly implementation: only the first user prompt reserves anchored end space. Later prompts follow the conversation end. This was selected after comparing the two behaviors interactively.

Provider compatibility advisories use the pinned upstream engine baseline (`0.0.46`) while the displayed Test Rig release remains independent. This keeps CLI warnings applicable to the imported engine. Native OpenCode startup still requires 2.x.

## Provider verification scope

Claude and Codex received the main live acceptance pass. OpenCode received the
requested minor sanity check: Homebrew OpenCode 2.0.22 with Fledge Alpha Free
completed a native turn and recalled its token after a browser reload. The older
`~/.opencode/bin/opencode` executable remains outside this verification; no
provider installation or authentication was changed.

## Integrated implementation

The active registry constructs upstream's native Codex, Claude, and OpenCode 2
adapters directly. Native provider events flow into upstream V2 runs, nodes,
requests, background work, child conversations, and recovery services. The old
Codex/Claude translation bridge and retained Agents panel are removed from the
active path. Model selection and setup still use Test Rig's native CLI registry.

The shared client consumes upstream V2 shells and projections. The main timeline
and side chats reuse upstream streaming entries, including signed attachment
previews and optimistic messages. Older-history controls, whole-thread Find,
child conversation navigation, model/effort labels, and result previews use the
native identities. Rich drafts and temporary side context remain Test Rig additions.

Project-setting patches replace individual overrides and accept explicit removal;
legacy per-setting maps are translated into that canonical record. Test Rig's
explicit local-checkout default is retained. Queued/snoozed state reads native run
status rather than guessing from a recent message timestamp.

Server shutdown leaves background work for upstream recovery to classify and
report on restart. Manual stop and runtime failure still release it immediately.
Checkout leases use normalized paths. Startup access to the same checkout remains
serialized against cleanup; already-started sessions can run concurrently.

Runtime dependencies include Effect 4.0.0-rc.115, TypeScript 7.0.2, Vite+ 1.0.0,
and the pinned nightly's provider protocol/client updates. Desktop bundles
explicitly disable declaration output, as upstream does with Vite+ 1.0.

## Verification and surfaces

Focused checks cover native adapters; restart replay and background notices;
native forks and checkpoint rollback; explicit PR association; workspace cleanup;
client history/reconnect and subagents; rich drafts, Find, and project settings.
The client state batch passed 198 tests after restoring the retained stale-page
guard, which prevents history paging from resurrecting rollback-hidden messages.
The final timeline batch passed 195 tests, the provider startup/session batch 58,
workspace cleanup 27, and settings/snooze 81. These are separate focused batches,
not a repository-wide test run. Changed-file lint reports warnings but no errors. All seven affected package
typechecks pass. The final runtime layer/startup batch passed 125 tests.

The isolated web app completed real Codex and Claude turns and native subagent
work. A Codex temporary side chat correctly recalled the parent's frozen context.
Find matched inherited conversation text. Markdown draft formatting survived a
reload. A subsequent 20-line response completed at the conversation end. The
rebuilt desktop connected to its disposable backend and opened a projectless
composer with native provider controls; the smoke-test desktop was then stopped.

Both web and desktop share the migrated client state. Desktop protocol preflight
coverage is retained. Explicit remote browser transport remains supported, but no
separate remote-host smoke test was run. No managed provider setup, excluded
provider, hosted discovery, relay, or telemetry service is added. OpenCode unit,
protocol, readiness, and session checks pass, plus the limited free-model live
check described above.

## Final acceptance pass (October 3, 2026)

- Migrated a consistent, read-only backup of the real legacy database into a
  disposable home. All six original message records and all 38 historical
  migration ledger entries were preserved. The source database hash stayed
  unchanged. The imported Claude conversation resumed and recalled its earlier
  topic. Focused fixtures additionally cover long histories, attachments,
  import idempotency, and migrations through V2 schema 43.
- Restarted the isolated backend with a Codex child and Claude background work
  outstanding. Interrupted work settled without a permanent busy indicator;
  both parent conversations subsequently recalled their verification tokens.
- Found and fixed Codex child recovery after session recreation. On a native
  resume notification, the adapter lazily loads the saved child identity and
  provider-turn ordinal. The existing child conversation and parent preview
  now receive the resumed answer. Regression replays cover both notification
  orders; the live child completed with the same identity after restart.
- Claude supervised approval stayed actionable across a browser reload. Approving
  wrote the exact one-line fixture and exposed its diff. A rich Markdown draft
  with an image survived reload; a valid pasted image reached Claude and its
  two colors were identified correctly.
- Explicit PR association was linked, then unlinked, in the imported copy.
  The check exposed GitHub CLI choosing a fork's upstream for numeric lookup;
  numeric references now resolve through the configured provider remote.
  Tests cover SSH, HTTPS, enterprise hosts, and explicit URL preservation.
- Retained Find, native side chats for Claude and Codex, child navigation,
  Markdown drafts, desktop connection, and response scrolling were exercised
  in the integrated passes above. Worktree cleanup guards were covered by the
  focused 27-test cleanup suite; no live checkout was deleted for acceptance.
- Final focused batches passed: Codex adapter 124; turn startup/routing 61;
  PR provider/registry/service 32; migration plus cleanup 33. Recovery/replay,
  PR, and pending-request checks also passed in the earlier acceptance batch.
  Server typecheck, server bundle, changed-file formatting and lint passed
  (lint retains existing unused-declaration warnings). No repository-wide
  suite was run.

The test homes and logs are retained for diagnosis. The task-owned desktop,
Vite watcher, migration server, temporary browser tabs, and viewport override
were stopped or closed after verification. No commit, push, PR creation, Linear
update, provider authentication change, or modification of the real database
was performed during acceptance. A separate remote-host smoke test remains
outside this local-first acceptance scope.
