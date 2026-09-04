# Selected upstream ports

These changes were selected from T3 Code nightly
`v0.0.39-nightly.20260904.1278` and adapted to Test Rig's existing implementation.

| Upstream change                                                                                     | Test Rig scope                                                               |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [#8630](https://github.com/pingdotgg/t3code/pull/8630)                                              | Avoid saving confirmed file contents again when closing an editor.           |
| [#9197](https://github.com/pingdotgg/t3code/pull/9197)                                              | Transfer composer contents when a draft becomes a canonical thread.          |
| [#8605](https://github.com/pingdotgg/t3code/pull/8605)                                              | Buffer incomplete Codex input lines as fragments.                            |
| [#3902](https://github.com/pingdotgg/t3code/pull/3902)                                              | Allow five minutes for worktree removal, preserving existing error handling. |
| [#9644](https://github.com/pingdotgg/t3code/pull/9644)                                              | Restore a single ready stash entry with the existing stash shortcut.         |
| [#9658](https://github.com/pingdotgg/t3code/pull/9658)                                              | Show unsent-content markers in both sidebar layouts and sidebar search.      |
| [Pin shortcut](https://github.com/pingdotgg/t3code/commit/4c51b4c9b6a85d96a22e0df41d5cfd2d8fc9901d) | Toggle pinning through existing thread actions and capability checks.        |
| [#8089](https://github.com/pingdotgg/t3code/pull/8089)                                              | Settle or restore the active thread from the keyboard.                       |
| [#9363](https://github.com/pingdotgg/t3code/pull/9363)                                              | Close the active right-panel tab with the close shortcut.                    |
| [#2403](https://github.com/pingdotgg/t3code/pull/2403)                                              | Copy repository-relative diff paths using the existing clipboard hook.       |
