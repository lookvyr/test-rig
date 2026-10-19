# Sidebar

The sidebar in web and desktop shows a flat thread list,
with active work shown as cards and settled threads as compact rows.

Repository grouping keeps each fork separate from its upstream repository and from other forks. Checkouts of the same fork can still group together, using that fork's repository name.

## Working section

Turn on **Working section** in **Settings → Beta** to fold busy threads into a
collapsed shelf. Expand **Working** to see them all. The thread you have open
stays visible even when the shelf is collapsed, and sidebar search still finds
every thread in it.

Threads return to the top of the main list when they finish, fail, or need an
approval, answer, or plan review, including requests from delegated children.
Background agents and PR watches stay in
Working while they need no attention. Pinned threads stay pinned; snoozed and
settled threads keep their own sections. This changes only sidebar presentation
and does not stop, snooze, or settle any work.

The toggle is off by default and is saved on this client. Turning it off restores
the usual sidebar order. It works in both web and desktop.

## Agent conversations

When a provider starts a subagent, open its conversation from the parent thread's
agent activity. Subagent conversations stay out of the main sidebar; independent
threads and forks remain visible. The child shows its messages, tools, model, effort, and current
status, with a link back to its parent. Provider-owned child conversations show
status controls in place of a composer; answer their approvals and questions in
the parent. Completed agents stay completed when a late completion update arrives.

You can still open temporary side chats from a completed Codex or Claude turn.
See [Side chats](./side-chats.md) for how their context and lifetime work.

## Settle, snooze, and archive

Use a thread's actions menu from its heading or sidebar row. **Settle thread**
moves it out of Active; **Un-settle** brings it back. **Auto-settle behavior**
lets you disable automatic settlement for an individual thread.

**Snooze** hides a thread until the chosen time. Choose **Custom…** for a date
and time or a duration. **Wake thread** brings it back early. Snoozing alone
does not send a message. Custom snooze is also available for selected sidebar
threads.

Snoozing keeps PR watches and automatic updates active. Pending automatic
notifications and subagent completion reports do not prevent snoozing; a queued
message from you still does. Snoozing and waking preserve those deliveries.

**Archive thread** removes a stopped thread from the usual list while keeping
its history. Open **Settings → Archive** to unarchive it. Archive is separate
from settling or deleting a thread.

## Resizing

Drag the sidebar edge to change its width. Releasing saves that width. Collapsing
the sidebar during a drag cancels the unsaved change; the restored width still
fits the current window.
