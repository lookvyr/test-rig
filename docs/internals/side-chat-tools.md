# Side-chat orchestration tools

Side chats use normal V2 threads and MCP credentials. Their `sideOfThreadId`
controls presentation and lifetime, not the orchestration capability grant.
Subagents use ordinary `subagent` lineage, with `sideOfThreadId: null`; inheriting
that field incorrectly made their first turn require native side-chat context.

Closing a side chat deletes its delegated descendants recursively. Independent
historical forks and threads explicitly created with `create_threads` remain
independent. Deleted threads reject new messages and MCP reads; their provider
credentials are revoked during session cleanup. Internal event history remains.
Temporary descendants share the owning main conversation's dispatch lock so
new delegation cannot race deletion. Provider sessions shared by several
threads receive a separate detach effect for each deleted thread.

## Tool audit (October 9, 2026)

The audit covers the orchestrator toolkit and adjacent thread, worktree, and PR
tools. There is no separate reduced side-chat toolkit. Existing project scope,
active-run ownership, provider availability, permission modes, and explicit
user authorization still apply.

| Tools                                                                                                                 | Availability and fit                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator_capabilities`                                                                                           | Available; discovers the same providers and orchestration features as a main thread.                                                            |
| `delegate_task`, `task_status`, `task_cancel`                                                                         | Available; appropriate for temporary work. Delegated children and further descendants belong to the side chat's cleanup tree.                   |
| `t3_thread_list`, `t3_thread_read`, `t3_thread_search`, `t3_thread_wait`                                              | Available under normal project/attached-context access rules. Deleted chats are not readable through these tools.                               |
| `t3_thread_send`, `t3_thread_interrupt`                                                                               | Available under normal active-caller and permission checks. Already-delivered messages survive closing the sender.                              |
| `t3_thread_update`                                                                                                    | Available for renaming, title regeneration, and PR metadata. Useful for meaningful side-chat tab titles.                                        |
| `request_secret`                                                                                                      | Available with the normal active-run and user approval flow. Closing cancels pending runtime requests.                                          |
| `t3_pending_request_*`, `t3_queue_*`                                                                                  | Available with the normal target, runtime-mode, and request-state checks. They operate on the existing thread runtime.                          |
| `t3_thread_configuration`, `t3_thread_configure`                                                                      | Available. Existing provider-switch restrictions still apply to a side chat; this change does not add provider switching.                       |
| `link_pull_request`, `unlink_pull_request`, `list_thread_pull_requests`, `watch_pull_request`, `unwatch_pull_request` | Available. Deletion removes watches for the side chat and its deleted descendants; late watch wakes cannot restart a deleted chat.              |
| `t3_worktree_status`, `t3_worktree_list`, `t3_worktree_handoff`                                                       | Available under existing worktree capability and lifecycle checks. A handoff is an explicit workspace change, and file changes survive closing. |
| `create_threads`, `t3_thread_fork`, `t3_thread_transfers`                                                             | Available. Creating/forking deliberately produces an independent durable chat; it is not a way to create another temporary tab.                 |
| `list_scheduled_tasks`, `delete_scheduled_task`, `run_scheduled_task_now`                                             | Available under existing project/permission checks. These act on persistent project schedules, not on temporary chat ownership.                 |

## Flagged lifecycle mismatches

These remain available; this change does not silently remove general project
management tools from side chats.

- `schedule_task` defaults to binding persistent recurring work to the current
  thread. `update_scheduled_task` can bind it there too. Binding a schedule to a
  side chat or one of its descendants is a poor fit: its target disappears on
  close/restart. Prefer rejecting such bindings in a follow-up. Explicit
  schedules that create independent threads are a separate durable action.
- `t3_thread_organize` can pin, snooze, settle, or archive its target. Pinning and
  unread state have no useful sidebar presentation for a side chat; archiving
  one leaves an open temporary tab unusable. Prefer rejecting these actions
  when the target is temporary while retaining organization of ordinary chats.

## Verification boundaries

`SideChat.test.ts` exercises independent sides, parent deletion, native context
capture without resuming the parent, nested MCP delegation/status/cancellation,
recursive deletion, surviving siblings and independent forks, rejected late
messages, and revoked chat access. Existing side-chat MCP tests cover sending
and reading other threads, including accepted messages surviving discard.
`SubagentProjection.test.ts` covers clearing the side marker on subagents.
`ThreadDeletion.test.ts` covers cancellation, disposed result deliveries, and
separate cleanup for threads sharing a provider session.

Right-panel tests cover distinct tabs, reconciliation, hidden-panel state,
legacy singleton migration, and exclusion from closed-tab history. Live Codex
verification additionally exercised two concurrent chats, native forks, actual MCP delegation, a running child and grandchild disposed on close, successful provider cleanup receipts, a surviving sibling follow-up, and independent drafts across tab switches and panel collapse.
Live Claude Sonnet verification exercised two native side chats, inherited
parent context, MCP subagent delegation, reading a main-thread message added
after the fork, and sending a message back with a verified main-thread reply.
Closing one side removed its child and grandchild, cancelled the still-active
grandchild, and completed all three provider-session cleanup receipts. The
surviving side answered a follow-up, and its sibling's draft survived tab
switches before disposal. OpenCode side chats remain unsupported.
