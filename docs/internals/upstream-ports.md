# Selected upstream ports

## October 7 pretrial batch

Selected against upstream `14fe0158ed`, adapted to Orchestrator V2 on Test Rig's
`codex/orchestration-v2` branch. Each item received an independent Astra review.

| Upstream change                                          | Retained scope                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [#14595](https://github.com/pingdotgg/t3code/pull/14595) | Preserve composer caret on refocus and file-chip insertion.                                            |
| [#11500](https://github.com/pingdotgg/t3code/pull/11500) | Keep partial workspace search results when scans time out.                                             |
| [#16878](https://github.com/pingdotgg/t3code/pull/16878) | Keep active child cards visible after the parent finishes.                                             |
| [#16260](https://github.com/pingdotgg/t3code/pull/16260) | Serialize shared Codex initialization.                                                                 |
| [#15571](https://github.com/pingdotgg/t3code/pull/15571) | Clean up interrupted provider startup and credential ownership.                                        |
| [#16917](https://github.com/pingdotgg/t3code/pull/16917) | Unload idle Codex threads while retaining the shared runtime.                                          |
| [#16486](https://github.com/pingdotgg/t3code/pull/16486) | Preserve late Claude native-child frames and terminal tool states.                                     |
| [#16897](https://github.com/pingdotgg/t3code/pull/16897) | Fresh Claude prompt UUIDs and completed-without-start handling.                                        |
| [#15834](https://github.com/pingdotgg/t3code/pull/15834) | Protect hidden nonignored untracked files during worktree removal. Ignored files still permit removal. |
| [#16771](https://github.com/pingdotgg/t3code/pull/16771) | Bound large untracked-file indexing during status refresh.                                             |
| [#15666](https://github.com/pingdotgg/t3code/pull/15666) | Passive sidebar subscriptions retain local status without remote polling leases.                       |
| [#15266](https://github.com/pingdotgg/t3code/pull/15266) | Virtualize palette results and debounce search-derived filtering.                                      |
| [#16652](https://github.com/pingdotgg/t3code/pull/16652) | Strip unused image bodies before persistence and serve retained images outside chat projections.       |

The image port includes the minimal signed-image serving dependency from
[#16199](https://github.com/pingdotgg/t3code/pull/16199), using the existing asset
route and wire projector. Codex MCP results retain image content alongside
structured metadata. It does not introduce a separate detail-fetch architecture.

See [verification evidence and limits](pretrial-batch-2026-10-07.md).

## Earlier selected ports

These changes were selected from T3 Code nightly
`v0.0.39-nightly.20260904.1278` and adapted to Test Rig's existing implementation.

| Upstream change                                                                                     | Test Rig scope                                                                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [#8630](https://github.com/pingdotgg/t3code/pull/8630)                                              | Avoid saving confirmed file contents again when closing an editor.                                                          |
| [#9197](https://github.com/pingdotgg/t3code/pull/9197)                                              | Transfer composer contents when a draft becomes a canonical thread.                                                         |
| [#8605](https://github.com/pingdotgg/t3code/pull/8605)                                              | Buffer incomplete Codex input lines as fragments.                                                                           |
| [#3902](https://github.com/pingdotgg/t3code/pull/3902)                                              | Allow five minutes for worktree removal, preserving existing error handling.                                                |
| [#9644](https://github.com/pingdotgg/t3code/pull/9644)                                              | Restore a single ready stash entry with the existing stash shortcut.                                                        |
| [#9658](https://github.com/pingdotgg/t3code/pull/9658)                                              | Show unsent-content markers in both sidebar layouts and sidebar search.                                                     |
| [Pin shortcut](https://github.com/pingdotgg/t3code/commit/4c51b4c9b6a85d96a22e0df41d5cfd2d8fc9901d) | Toggle pinning through existing thread actions and capability checks.                                                       |
| [#8089](https://github.com/pingdotgg/t3code/pull/8089)                                              | Settle or restore the active thread from the keyboard.                                                                      |
| [#9363](https://github.com/pingdotgg/t3code/pull/9363)                                              | Close the active right-panel tab with the close shortcut.                                                                   |
| [#2403](https://github.com/pingdotgg/t3code/pull/2403)                                              | Copy repository-relative diff paths using the existing clipboard hook.                                                      |
| [#8804](https://github.com/pingdotgg/t3code/pull/8804)                                              | Include local instruction files only in repository-conventions writing mode, preserving separate custom instruction fields. |
| [#8751](https://github.com/pingdotgg/t3code/pull/8751)                                              | Allow a local worktree base when origin has no matching branch.                                                             |

Test Rig also removes the built-in PR description section headings. Explicit writing
instructions and enabled repository templates still determine the body structure.

Batch 3 adapts [#8968](https://github.com/pingdotgg/t3code/pull/8968) to preserve
file-tree paths and stable diff identities across refreshes, and
[#7490](https://github.com/pingdotgg/t3code/pull/7490) to reload the selected text
file from the Files refresh button. Both workspace panels also refresh on the
active thread's completed-turn projection, including interrupted or failed turns.
The editable file surface preserves its visible line when refreshed contents reset
the renderer's line-height measurements.

[#9125](https://github.com/pingdotgg/t3code/pull/9125) retries cached missing PRs
after turns through the existing status broadcaster. Remote cache writes are
serialized per workspace; known PRs, lookup failure backoff, background policy,
and hosting-integration switches remain effective. Local remote-tracking refs
identify branches pushed under their own name while still tracking the default
branch. Saved-branch PR lookup and automatic pulling are outside this port.

[#9068](https://github.com/pingdotgg/t3code/pull/9068) retains the Electron debugger
object for each browser-preview control session, preventing garbage collection
from detaching active control and allowing cleanup after its webview is destroyed.
The regression test uses Test Rig's existing tab-close lifecycle.

[#8889](https://github.com/pingdotgg/t3code/pull/8889) adds an expand/collapse-all
control to the Files tree using its existing model and native directory handles.

[#10670](https://github.com/pingdotgg/t3code/pull/10670) shares the desktop native
context menu with embedded browser tabs and targets the clicked contents and
frame. Test Rig keeps its existing same-tab handling of popup links, so this port
does not add separate popup-window handling.

[#10501](https://github.com/pingdotgg/t3code/pull/10501) adapts browser snapshots
for agent use. MCP text and structured metadata share a 60 KB encoded JSON cap,
exclude the full accessibility tree, shorten labels and diagnostics, and preserve
complete selectors while reporting omissions. The desktop snapshot contract is
unchanged. `includeImage=false` omits the image response; `save=true` writes a PNG
under the environment's `browser-artifacts` directory and returns `screenshotPath`
and `screenshotMarkdown`. Test Rig displays those saved screenshots through its
existing signed asset API, scoped to generated PNG names and the connected
message environment. `preview_evaluate` returns an object containing `value` so
arrays, scalars, objects, and null are valid MCP structured results.

[#10689](https://github.com/pingdotgg/t3code/pull/10689) gives provider sessions a
full inactivity window after a turn settles. Cleanup uses the newer of the
runtime binding's last activity and the projected session timestamp, retaining
the active-turn guard. Tests drive sweep completion with a clock receipt.

[#4308](https://github.com/pingdotgg/t3code/pull/4308) adds the unbound `thread.stop`
command through the existing interrupt action. Settings lists commands without
default bindings. The main conversation shortcut yields while a side chat has
focus.

[#8531](https://github.com/pingdotgg/t3code/pull/8531) adds previous/next turn
controls to the existing minimap, preserving Test Rig's composer inset and
virtualized scrolling.

September 14 reliability batch:

- [#11324](https://github.com/pingdotgg/t3code/pull/11324) caches bounded image
  thumbnails for composer attachments, including annotated browser screenshots.
  Expanded previews and provider attachments retain their original images.
- [#10777](https://github.com/pingdotgg/t3code/pull/10777) releases consumed global
  event-replay pages with stream pagination, preserving ordering, limits, and
  repeatable reads without adding upstream's other replay services.
- [#11291](https://github.com/pingdotgg/t3code/pull/11291) makes the startup error
  screen's retry action invalidate router loaders after the backend recovers.
- [#7599](https://github.com/pingdotgg/t3code/pull/7599) bounds concurrent desktop
  backend shutdown to five seconds per instance so hung cleanup cannot block quit.

September 17 composer prototype:

- Adapted [#12160](https://github.com/pingdotgg/t3code/pull/12160) at
  `d359e94cabca4722029359c77d60cb6d13da1e59`: Tiptap replaces Lexical while
  keeping Markdown drafts, the composer handle, and Test Rig's file, skill,
  and terminal chips. The local document adapter extends the upstream inline
  parser and cursor mapping to headings, ordinary lists, quotes, and fenced code.
  Enter always submits; Shift-Enter continues blocks. Syntax coloring reuses
  the existing local highlighter. Upstream citations, generalized context records,
  and the rich/plain setting are not included. Links, tables, and task checkboxes
  remain literal. The code mark permits nested formatting, addressing the issue
  identified in [#12290](https://github.com/pingdotgg/t3code/pull/12290).

## Threads without a project

Adapted [#13612](https://github.com/pingdotgg/t3code/pull/13612): one lazily created
project rooted at the environment's scratch directory, with a separate folder
per thread carried in `worktreePath`. Contracts and authorization advertise
`projects.ensureScratch` only alongside `scratchWorkspaceRoot`. No database
migration or provider changes are needed.

Test Rig uses the first 24 hex characters of a hash of the complete thread ID for
short, stable folder names across retries, omits upstream's custom icon and mobile changes, and preserves existing
drafts when changing the unsent draft's project. Development verification needs
an explicit `--home-dir` outside a Git checkout.
