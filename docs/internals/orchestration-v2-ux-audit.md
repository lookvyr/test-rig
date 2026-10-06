# Orchestrator V2 UX comparison — October 6, 2026

> The original findings below are retained as the before-state. All ten were
> implemented in the follow-up batch; see the verification appendix.

## Baseline and method

Test Rig: `ee2665910` on `codex/orchestration-v2`, matching origin at the start of
the pass. Reference: T3 Code `v0.0.46-nightly.20261006.2735`, the latest published
nightly returned by GitHub on October 6. Both the installed binary and the exact
tag's source were used; findings below are not comparisons with the older intake
baseline.

Three GPT-6.1-Sol agents compared composer/lifecycle, workspace/review, and
delegation/scheduling source in parallel. The primary agent exercised the paired
browser flows, with two agents using separate browser contexts against the same
two running servers for workspace and scheduling checks. No parallel server
stacks or product-code changes were introduced.

The pass used the existing isolated `loo33-state` and `loo33-upstream-state`
homes, disposable projects, real Codex and OpenCode turns, and Chromium at
1600×1000 plus a narrower 1100×850 viewport. Evidence is retained under
`/workspace/v2-ux-audit`, with matching PNG and accessibility snapshots. Existing
test state contains earlier verification conversations; it is not user production
state.

This is a findings audit, not a clean acceptance sign-off. Several useful upstream
behaviors have been missed in the adapted client wiring.

## User-flow coverage

| Flow | Paired observation and disposition |
| --- | --- |
| Create a project and start a chat | Added the same disposable local Git project in both apps. Project selection, current checkout, provider controls, send, streaming, and completion worked. Test Rig's existing project palette, rich composer, and local-checkout default are retained adaptations. |
| Create a worktree and run project setup | Saved the same automatic setup action, created a worktree, and completed a real Codex response in each app. Upstream surfaced slow setup and failure; Test Rig did not. **F2.** |
| Approve a tool action | Both displayed a real supervised Codex command approval. Upstream uses a compact approval card and a secondary menu; Test Rig uses four fixed buttons. The fixed choices also miss provider-advertised options. **F3.** |
| Answer a question and receive a plan | Enabled legacy plan mode in isolated settings, requested a native Codex format question, selected a choice, and received plans in both apps. Ordinary label-based choices worked. Native distinct-value questions have a source-confirmed gap. **F4.** |
| Refine a plan with an image | Attached the same icon in both apps. Test Rig kept Refine and silently dropped the image; upstream switched to ordinary submission and retained it. The Test Rig provider explicitly could not see the image; upstream identified the T3 icon. **F1.** |
| Stop during startup | Running-turn Stop was visible. Preparing/starting cancellation was compared through source and existing tests; a deliberately delayed provider-start browser run was not added. **F5.** |
| Delegate, inspect a child, then follow up | Real app-managed children completed in both apps. Opening children and returning to parents worked. During a new child turn, Test Rig kept it under Previous agents/Done; upstream displayed one running agent. **F6.** |
| Switch providers and retain context | Codex → OpenCode succeeded in both apps and recalled the original marker. Test Rig also switched back to Codex and recalled it again. Upstream displayed Default; Test Rig persistently displayed Unknown for the OpenCode variant. **F8.** |
| Fork historical context | Forked the first response after later parent activity. Both opened the selected earlier history without the later delegation turn. Test Rig retains explicit parent navigation and omits merge-back/rewind by decision. |
| Inspect Changes | Both showed the same one-line dirty diff. Test Rig's Review panel retained staging, file navigation, and its preferred presentation; upstream uses its own Diff panel. Only upstream's entry button showed `+1 -0`. **F9.** |
| Inspect workspace identity | Current checkout/worktree selection worked. Upstream names the actual workspace and supports full-path interactions; Test Rig shows a generic kind. **F10.** |
| Configure recurring tasks | Compared empty lists, new-task dialogs, project/workspace choices, time fields, and settings. Test Rig's explicit permissions and server-timezone disclosure are useful additions. Its permissions initialization ignores project overrides. **F7.** This pass did not repeat real schedule dispatch; the preceding LOO-33 acceptance covered two no-project runs and a settled first thread. |
| Configure usage-limit recovery | Both apps showed opt-in auto-resume and snooze switches off. No actual limited thread was available for another live recovery run. No new source discrepancy was established. |
| Reload and navigate | Browser reload preserved the live handoff history in both apps. Child/parent, historical-fork, settings, and review navigation worked. This was not a backend-restart recovery test. |
| Preserve Test Rig additions | Whole-thread Find matched the marker across history. The separate Review panel remained intact. Temporary side-chat opening, inherited context, and discard were checked separately; these do not require replacing the fork's layout with upstream's. |

## Confirmed findings

### F1 — Plan refinement drops attached images

**Fix first; paired browser reproduction and source proof.**

Test Rig's plan follow-up branch clears the rich draft and forwards only text and
context; its callback submits `attachments: []`. Upstream's callback also accepts
text only, but importantly its visibility helper and send handler exclude drafts
with attachments, sending them through the ordinary attachment-preserving path.
The missing guards make this a missed port, not an upstream bug.

- Test Rig: `apps/web/src/components/ChatView.tsx:4906`, `:5457`.
- Upstream: `ChatView.tsx:3395`, `:8844`; `ChatView.logic.ts:935` and the
  attachment case in `ChatView.logic.test.ts:488`.
- Evidence: `test-plan-image-before/sent/result.png` and
  `upstream-plan-image-before/sent/result.png`.
- Port the attachment guard while retaining the rich composer and its draft
  restoration behavior. Verify image-only and text-plus-image plan follow-ups.

### F2 — Worktree setup progress and failure are not presented

**Fix early; paired browser reproduction and source proof.**

The disposable automatic setup action printed a marker, waited 15 seconds, then
exited 7. Both agents answered normally. Upstream showed a running setup pill,
then “Worktree ready, setup script failed”, Details, and Open terminal. Test Rig
showed neither the running setup information nor its failed outcome.

The tracker/card types exist, but Test Rig lacks upstream's setup subscription and
cancel RPC/client wiring. `MessagesTimeline` defaults `worktreeSetup` to null;
`ChatView` never supplies it. Its local dispatch calls also pass
`preparingWorktree: false`.

- Test Rig: `apps/web/src/components/chat/MessagesTimeline.tsx:496` and
  `apps/web/src/components/ChatView.tsx:5208`.
- Upstream: `ChatView.tsx:3904`, `:11080`; client-runtime `state/vcs.ts:321`.
- Evidence: `worktree-test-rig-running/settled.png` and
  `worktree-upstream-running/settled.png`.
- Port the full observable setup flow and supported actions, not just the card.
  Preserve the accepted background setup ordering for active worktree handoffs.

Setup cancellation, Work locally, and terminal-opening actions were
source-compared, not exercised live; live verification covered the running
indicator and failed outcome.

### F3 — Approval presentation ignores provider choices

**Source-confirmed behavior gap; ordinary approval UI compared live.**

Test Rig always renders Cancel turn, Decline, Always allow this session, and
Approve once. It does not consume the options already preserved by the client
projection. Native adapters can advertise persistent approval or omit session
approval. Upstream forwards and renders those choices, using a compact card and
secondary menu for additional actions.

- Test Rig: `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx:37`,
  `ChatComposer.tsx:2898`; client-runtime `state/threadRequests.ts:92`.
- Provider evidence: `apps/server/src/provider/CodexMcpElicitation.ts:146` and
  its existing once-only/persistent-choice tests.
- Upstream: `ChatComposer.tsx:6656`, `ComposerPendingApprovalActions.tsx:91`.
- Evidence: `test-approval.png`, `upstream-approval.png`,
  `upstream-approval-options.png`.
- Adopt upstream's option-aware approval UI. Unusual persistence choices were
  source/test-verified, not all reproduced through live provider prompts.

### F4 — Native question values are replaced with display labels

**Source-confirmed; distinct-value live case not exercised.**

Test Rig selects and submits `option.label`. OpenCode's adapter preserves a
separate `option.value` and forwards answers to the native form without a later
conversion. For `{label: "Production", value: "prod"}`, the current path sends
`Production`. Upstream selects/validates `value ?? label`, including exact empty
or whitespace-containing values. Ordinary Codex label-based questions worked in
the browser, which does not cover this failure.

- Test Rig: `apps/web/src/pendingUserInput.ts:57`,
  `components/chat/ComposerPendingUserInputPanel.tsx:153`.
- Adapter: `apps/server/src/orchestration-v2/Adapters/OpenCode2AdapterV2.ts:540`,
  `:556`, `:4069`.
- Upstream: `pendingUserInput.ts:53` and `pendingUserInput.test.ts:206`.
- Port the value semantics and tests together, preserving custom answers and
  multiple selection.

### F5 — Stop is missing while a run is preparing or starting

**Source-confirmed; slow-start browser reproduction remains follow-up work.**

The existing helper explicitly treats preparing/starting runs as interruptible.
Test Rig computes it for keyboard handling, but the composer button is gated only
on `phase === "running"`. These earlier phases map to connecting. Upstream
passes `canInterrupt` independently of the running flag all the way to the button.

- Test Rig: `apps/web/src/session-logic.ts:989`, `:1002`;
  `components/chat/ChatComposer.tsx:3416`; `ComposerPrimaryActions.tsx:144`.
- Upstream: `ChatView.tsx:11293`, `ChatComposer.tsx:7523`,
  `ComposerPrimaryActions.tsx:250`.
- Restore the separate interruptibility wiring. This does not reintroduce
  interactive message queuing, which remains excluded.

### F6 — A delegated child's later activity remains shown as Done

**Paired browser reproduction and source proof.**

After the initial child task completed, a new child turn was started. Test Rig's
parent view retained “Previous agents” and “Done” with the original elapsed time.
Upstream moved it into the active list and displayed “Lineage · 1 running”.

- Test Rig: `packages/client-runtime/src/state/threadRelationships.ts:90`;
  `apps/web/src/components/chat/ThreadRelationshipsControl.tsx:227`, `:297`.
- Upstream uses the child's live `activityRunStatus`, counts live edges, and
  adjusts timer/result metadata for subsequent runs.
- Evidence: `test-child-active-shows-done.png`,
  `upstream-child-followup-parent.png` and both active tooltip captures.
- Port the live activity derivation inside Test Rig's existing Agents surface.

### F7 — New schedules ignore project permission defaults

**Browser reproduction with isolated settings override and source proof.**

With the environment default Full access and the selected project's override
Supervised, a new schedule still showed Full access. The editor initializes
`runtimeMode` only from environment settings; changing the project never resolves
that project's override. Model defaults already use project settings correctly.
The temporary override was removed and the original settings file restored.

- Test Rig: `apps/web/src/components/settings/ScheduledTasksSettings.tsx:534`,
  `:764`; project-scoped definition in `packages/contracts/src/settings.ts:630`.
- Evidence: `schedules-fork-supervised-override.png`, `schedules-notes.txt`.
- This is a Test Rig integration gap, **not** a missing upstream schedule fix:
  the reference schedule form has no permission selector and hardcodes Full
  access. Resolve defaults for a new task without overwriting explicit choices
  on saved tasks.

### F8 — OpenCode's reported default variant displays as Unknown

**Paired browser reproduction and read-only persisted-state/source proof.**

After the successful Codex → OpenCode handoff, Test Rig displayed “Unknown ·
Build”; upstream displayed “Default”. The saved OpenCode selection contained
only `agent=build`, while native metadata reported `variant=default`. This is
missing display wiring, not leaked Codex options or a failed handoff.

- Test Rig's `ChatComposer.tsx:1229` omits the report from traits input, and
  `TraitsPicker.tsx:421` calls `getProviderOptionCurrentLabel` without the
  reported selection. The shared helper intentionally returns Unknown when
  that information is absent.
- Upstream `ChatComposer.tsx:2941` forwards `reportedModelSelection` and
  `TraitsPicker.tsx:535` consumes it.
- Evidence: `test-handoff.png`, `upstream-handoff.png`.
- Port the reported-model display path while retaining provider-neutral storage.

### F9 / F10 — Small omissions in thread details

**Paired browser observations and source proof; lower priority.**

- **F9: Change totals.** The same dirty checkout showed `Changes +1 -0`
  upstream but only `Changes` in Test Rig. Test Rig's detached button in
  `ThreadDetailsPanel.tsx:99` does not consume totals from Git status. Add totals
  to the existing entry point; keep the preferred Review panel and fade/preload.
- **F10: Workspace identity.** Test Rig's `BranchToolbarEnvModeSelector.tsx:55`
  shows only Local checkout/Worktree. Upstream names the directory and provides
  a full-path tooltip and Copy full path action. Its corresponding lines 60,
  83, and 174 implement these. Add those interactions to the retained layout.

Evidence: `test-first-complete.png`, `upstream-first-complete.png`, both
`changes-ready.png` captures, and the worktree captures.

## Intentional differences to retain

The controlling decisions are in `FORK.md`, the nightly-sync preservation list,
and the later follow-up acceptance notes. None of F1–F10 requires reversing them.

- Keep Test Rig's Review/diff side panel, staging controls, fade-in/preloading,
  explicit PR link/unlink, rich drafts, whole-thread Find, and temporary side chats.
- Keep only Codex, Claude Code, and OpenCode, with CLI-managed setup. Do not import
  upstream's other providers, cloud/account/relay services, usage/pricing surfaces,
  managed installations, or release/update machinery.
- Keep steering-only interactive follow-ups; internal scheduled/deferred work is
  distinct. Do not port upstream's interactive queue preference as part of F5.
- Keep independent historical forks and parent navigation; no rewind, sent-message
  truncation, checkpoint restoration, or merge-back.
- Keep opt-in usage recovery, scratch isolation, worktree cleanup safeguards, and
  local-checkout defaults. Brand-specific generated branch names are expected.
- Keep app-owned delegation's shared checkout and self-contained task brief.
  Separate Agents-tab placement is an accepted adaptation; live status still needs
  F6 regardless of placement.

## Suggested repair sequence

1. Plan attachment routing, provider-native question values, and option-aware
   approvals. These affect what information/actions reach a provider.
2. Full worktree setup feedback and startup cancellation. Include slow, failed,
   canceled, and successful paths with the supported upstream actions.
3. Live child activity and reported model traits. Keep the current panel structure.
4. Project permission defaults in new schedules.
5. Change totals and workspace-path affordances in thread details.

No product decision is currently needed for this sequence. A separate potential
polish item is provider account badges on child headers/tooltips: exact nightly
wires them, but this pass did not configure multiple accounts to prove the
user-visible effect, so it is not counted among the confirmed findings.

## Verification limits and retained evidence

An existing focused batch passed 83 tests across pending-user-input helpers,
request projection, Codex elicitation, primary composer actions, and session
logic. Those tests corroborate contracts/helper behavior; passing them does not
cover the missing integration props found here. No repository-wide checks ran.

This pass exercised the shared web renderer, not a new Electron-shell acceptance
run or remote-host test. Claude was unavailable on this environment's PATH, so
live runs used Codex and OpenCode. Supervised Codex shell execution hit the
environment's socket-directory sandbox restriction; the ordinary approval UI
comparison remains valid, and Test Rig's provider completed after a second
explicit approval. Do not classify that host restriction as a Test Rig regression.

Scheduled dispatch/settle behavior, usage-limit execution, active-worktree moves,
all provider lifecycle permutations, backend restart recovery, and multi-account
badges were not exhaustively re-run. Their earlier ticket evidence remains
separate. Likewise, missing support for unrelated new nightly features is not
automatically a V2 port defect.

The three agent notes, browser scripts, screenshots, accessibility snapshots, and
disposable project are under `/workspace/v2-ux-audit`. No fix was committed,
pushed, or recorded as completed in Linear by this audit.


## Follow-up implementation and verification

The approved batch addresses F1–F10 while retaining Test Rig's rich composer,
side chats, steering-only interaction, project permissions, and Review panel.
Work locally is adapted to the V2 lifecycle: cancellation retains the failed
attempt, then submits the stored text, attachments, and context once in the same
chat's local checkout. It does not rewind or delete conversation history.

Independent review caught and resolved stale running setup snapshots after
reconnect, unavailable secondary approval actions, and a misleading workspace
label during creation. Integrated browser checks additionally found and fixed:

- Imported or edited scripts losing their explicit asynchronous setting.
- Missing upstream shimmer CSS rendering a duplicate live setup label.
- Client provider activation drifting from the server after returning to an
  existing native conversation, hiding its reported model defaults.

Final review found no remaining actionable issues in these changes or useful
simplifications that would improve them.

Verification before push:

- 340 tests passed across 17 focused files in the final integrated batch. The
  authenticated WebSocket setup subscription/cancel check also passed separately.
- Web, server, client-runtime, and contracts typechecks passed. The web build
  passed. Targeted lint had no errors; existing warnings and state-synchronization
  warnings remain. No repository-wide checks were run.
- Real Codex image-plus-text and image-only plan messages retained attachments;
  the provider identified the icon. Text-only refinement still worked.
- Real native questions and supervised command approvals completed. Compact
  approval cards and secondary choices were checked at wide and narrow widths.
  Distinct native question values and unusual approval choices were covered by
  focused tests, not live prompts for every provider variation.
- Synchronous setup showed stages/output, Details and Open terminal; both Stop
  and Cancel stopped preparation. Work locally completed the original prompt in
  the local checkout. Imported synchronous configuration was verified through
  the UI without a settings override. Background setup failure remained visible
  after a successful agent reply.
- A child follow-up appeared as running with a fresh timer. Codex → OpenCode →
  Codex → OpenCode retained the original marker; the reported Default trait
  appeared in real time and survived reload.
- New schedules honored the selected project's permission default and preserved
  an explicit permission selection when changing projects. Saved-task behavior
  was covered by focused tests.
- Workspace path copying returned the full path. Changes counts matched the
  retained Review panel, including its narrow layout. Whole-thread Find worked.
  A Codex side chat inherited the marker and could be discarded.
- Screenshot inspection covered 1600×1000 and 1100×850 layouts plus reduced
  motion. The shared renderer produced no captured page errors.

After-state screenshots, accessibility snapshots, recordings, and check logs
are retained under `/workspace/v2-ux-fixes`. The original paired evidence remains
under `/workspace/v2-ux-audit`. These are local verification artifacts, not shipped
product files. Claude, Electron shell, remote connections, actual usage-limit
recovery, and every lifecycle permutation were not re-run in this batch.


### Post-push comparison

Repeated source comparison with the same current nightly and paired browser
checks after the batch push. Conversation controls, plans and attachment routing,
Agents, Changes, schedules, narrow layouts, and preserved fork surfaces showed
no additional regression from the batch.

This pass also reproduced one pre-existing Test Rig-specific Review bug: after
opening a side-chat turn diff, the parent's Details → Changes retained the side
chat's turn selection and annotation target. Clearing that temporary target when
opening the parent's Changes restores its saved Review scope. A real side-chat
file change reproduced the issue; the corrected browser route used the parent
thread and composer target and restored its Uncommitted scope. Independent review
confirmed that the change preserves saved selections.

Multi-account identity badges remain a minor upstream presentation difference
outside this batch. No multi-account live case was exercised. All earlier
verification limits still apply. Post-push evidence is under
`/workspace/v2-ux-fixes/post-push`.


### Account indicators follow-up

The minor account-identification gap is now addressed using nightly's display
rules for supported providers. Agent hover cards in both the timeline and Agents
panel name the account and show its configured accent dot; native subagent bars
show an initials badge. A single unaccented account keeps the existing display.

Verified the Agents hover card with temporary provider-instance display settings,
then restored the original settings. Browser component fixtures covered native
bars and hover cards with one account, multiple accounts, and optional accents,
at wide and narrower widths. This tests presentation without claiming a second
authenticated account was exercised. Forty-five existing focused tests, the web
typecheck, targeted lint, and independent review passed. Temporary preview code
was removed; screenshots remain under `/workspace/account-badges`.
