# November 2 background work intake

This intake adapts upstream [T3 Code](https://github.com/pingdotgg/t3code)'s rule that a thread
holds only for background work the agent waits on, from
[#24610](https://github.com/pingdotgg/t3code/pull/24610), plus the background work wording from
[#28969](https://github.com/pingdotgg/t3code/pull/28969). Before it, any task left in a provider
thread's `pendingBackgroundTasks` roster, including a dev server, kept a thread pulsing as Working,
showed "Background work running", and blocked automatic settlement. Upstream code remains covered
by the repository's MIT license and attribution.

## Ported

- `awaited` on `OrchestrationV2PendingBackgroundTask` and on restart-cancelled work.
  `backgroundWorkHoldsCompletion` holds for subagents, unnamed `background_task` work, and any
  task marked awaited. Unmarked commands and monitors no longer hold. Pull request watches are
  derived as awaited monitors.
- `t3_background_wait` on the orchestrator MCP toolkit. It marks or unmarks Claude roster tasks by
  the task ID the agent saw, through `ThreadManagementService.awaitBackgroundTasks` and the
  optional `awaitBackgroundTasks` on the provider session runtime. The Claude adapter keeps marks
  per native thread, clears them when a task leaves the roster, and appends upstream's current
  instructions telling Claude to mark tests and builds, never work it leaves running, and to load
  the deferred tool with ToolSearch. Codex returns an error.
- Restart notes wake a settled thread for a shell or monitor only when it was awaited.
- From [#27468](https://github.com/pingdotgg/t3code/pull/27468): a delegated child's result is
  available once only unheld work remains, so a child that leaves a dev server running still
  reports back to its parent. Test Rig has no separate roster-settle watch, so only
  `delegatedTaskProgress` changes.
- `presentPendingBackgroundWork` titles single items as `Running · <label>` or
  `Waiting · <label>`, with command and monitor labels unwrapped from their shell.

## Adapted

`ThreadManagementService` now depends on `ProviderSessionManagerV2`, as it does upstream. Test
harnesses that build it without providers get an empty mock. The Claude adapter's
`awaitBackgroundTasks` runs without upstream's SDK message lock, which this fork does not have;
a lost race is repaired by the next roster or turn-settle emit, which reads the same marks.

Test Rig's sidebar keeps its own status model. A held thread shows a muted **Waiting** pill in the
classic sidebar and a **Waiting** label in the new design, replacing the fork's separate Working
and Monitoring states for background work, and stays in the Working section. A thread with only
unheld work shows no background status. Automatic settlement skips only held work.

The background work banner stays above the composer instead of moving to the end of the
timeline as in upstream [#25401](https://github.com/pingdotgg/t3code/pull/25401). It shows the
presentation title, a terminal or subagent icon instead of a pulsing dot, a clamped list of labels
when several tasks run, an elapsed timer for a single Codex command (the existing `AgentElapsed`
ticker), and the existing Stop button,
which already stays on "Stopping..." until the work clears.

## Not ported

The thread details **Servers** list from
[#22542](https://github.com/pingdotgg/t3code/pull/22542) landed separately; see the November 2
entry in [upstream-ports.md](./upstream-ports.md).
