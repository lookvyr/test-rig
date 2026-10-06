# Scheduled-task policy (LOO-14)

Decision date: October 6, 2026. Reference:
[T3 Code v0.0.46-nightly.20261006.2735](https://github.com/pingdotgg/t3code/tree/v0.0.46-nightly.20261006.2735).
The user directed Test Rig to adopt upstream UX unless a fork-specific decision
is needed. This records scheduling policy and the narrow busy-thread alignment;
LOO-33 owns the remaining settings UI and broader scheduling acceptance.

| Concern                      | Adopted behavior                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Busy existing conversation   | Queue scheduled prompts behind active work. Start when idle. Port the current upstream `mode: "queue"` change.                                                                                                                         |
| Successive runs              | Preserve upstream overlap behavior: reservation ends at dispatch acceptance. Same-thread work may queue; separate conversations may execute concurrently. No completion-scoped lock or skip-while-running default.                     |
| Status                       | Persist upstream `never`, `running`, `succeeded`, `failed` values. These describe dispatch, not agent completion. In LOO-33, make that distinction explicit in supporting copy; don't represent successful dispatch as completed work. |
| Timezone                     | Fixed-time schedules use the server's local timezone. LOO-33 should identify that timezone in the form instead of implying browser-local time. No per-task timezone selector.                                                          |
| Missed fixed-time occurrence | Allow at most ten minutes of lateness; otherwise skip to the next occurrence.                                                                                                                                                          |
| Missed interval              | Dispatch once when overdue; don't replay all missed intervals. The next interval starts after dispatch settles. Minimum one minute.                                                                                                    |
| Opt-in                       | No default tasks. Explicit task creation/enabling opts into recurring execution. Retain upstream's per-task Enabled control and pause/delete actions; no additional global feature toggle. Explicit Run now may run a paused task.     |
| Availability                 | Local server must run and machine must be awake. No OS wake or cloud scheduling guarantee.                                                                                                                                             |
| Launch settings              | New conversations use saved settings. Bound conversations retain their current workspace and permission mode, with the saved provider/model requested for the scheduled turn.                                                          |
| Pause/delete                 | Prevent future automatic dispatches; don't cancel already accepted work.                                                                                                                                                               |

This supersedes the older LOO-14 recommendation to prevent overlap by default.
The queue applies to internally scheduled work and fits FORK.md's retained deferred
work boundary. It does not restore interactive composer queuing. Upstream's newer
webhook features are outside this interval/fixed-time decision and are not ported.

The settings UI remains LOO-33. Its task list, create/edit form, per-task toggle,
and action menu should follow upstream, limited to retained local scheduling
capabilities. No unattended test schedules should remain enabled after verification.
