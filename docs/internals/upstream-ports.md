# Selected upstream ports

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
