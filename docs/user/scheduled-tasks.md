# Scheduled tasks

Ask an agent to schedule a recurring prompt, list your tasks, change one, pause it,
or delete it. A task can send into the current conversation or start a new
conversation for each run. No tasks are created automatically.

## When a task runs

A scheduled prompt sent to an existing conversation waits behind its current
turn. It does not steer or interrupt that turn. If the conversation is idle, the
prompt can start immediately. This behavior applies to scheduled work; messages
you send interactively still steer an active turn when steering is available.

The scheduler waits for the prompt to be accepted, not for the agent to finish.
The task's `succeeded` status means that dispatch succeeded. Inspect the resulting
conversation to see whether the agent finished successfully.

Successive scheduled runs can overlap. Runs targeting the same conversation can
accumulate as queued work; runs creating new conversations can execute at the same
time. Choose an interval that suits the expected work duration.

New conversations use the provider, model, permission mode, and workspace settings
saved with the task. A task bound to an existing conversation runs in that
conversation's current workspace and permission mode, with the provider and model
saved on the task.

## Time and missed runs

The Test Rig server must be running and its machine awake. Closing a browser tab
does not stop a separately running server. Tasks do not wake the computer or use
an operating-system or cloud scheduler.

Fixed-time schedules use the timezone of the machine running Test Rig's server.
That may differ from the timezone of a browser connected to it. A fixed-time run
up to ten minutes late can still run; a later one is skipped until the next
scheduled occurrence.

Intervals have a one-minute minimum. An overdue interval runs once when the
scheduler resumes, rather than replaying every missed occurrence. The next
interval is measured from the end of dispatch, not from completion of the agent's
work.

## Pause and delete

Pausing keeps the task saved and prevents future automatic runs. Deleting removes
the schedule. Neither action cancels work already accepted by a conversation; use
that conversation's Stop control if needed. An explicit Run now can dispatch a
paused task without enabling its recurrence.
