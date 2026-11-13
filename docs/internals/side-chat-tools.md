# Side chats

Side chats follow upstream T3 Code's model (nightly `v0.1.10-nightly.20261112.4606`,
introduced in upstream `50c1c5dc53`): a side chat is an ordinary V2 fork whose
lineage carries `sideChat: true`. Earlier Test Rig side chats were temporary
threads marked with `sideOfThreadId`; that field remains only so startup can
delete any left over from before the change.

## Lifecycle

- **Open.** The client dispatches `thread.fork` with `sideChat: true` and
  `sourcePoint: latest_stable`. A side chat may open before the parent has a
  stable run; its context is then the parent's whole history as a digest. The
  fork is refused for an archived or deleted parent, a parent whose worktree is
  still being prepared, a side chat, or a subagent. Side chats get
  `forkedFrom: null`, so their timeline shows only their own rows.
- **First turn.** The pending fork transfer resolves as usual: a native fork
  when the provider, native reference, and capabilities allow it and the parent
  has no active run after the fork point (`sourceBusy`), otherwise a portable
  `full_thread_summary`. `prepareSideChatContext` adds a `manual_context`
  handoff with upstream's framing note, a digest of parent activity after the
  fork point (8,000-character cap), and a `t3_thread_read` pointer. It is sent
  inline with the first prompted turn and marked delivered once accepted. No
  "Fork context" row is added; the client shows a "Context from" divider.
- **Close.** Closing the tab dispatches `thread.delete` with `onlyIfUnused`,
  which deletes only a thread with no runs and no messages and otherwise
  succeeds without events. Closed side chat tabs enter closed-tab history.
- **Delete.** Deleting a side chat deletes its subagent descendants. Deleting
  the parent deletes its side chats and their descendants. A side chat and its
  subagents share the parent's dispatch lock, and a side chat fork takes the
  parent's lock, so delegation and side chat commands cannot race the cascade.
- **Bring back.** The client dispatches `thread.merge_back` from the side
  chat's latest finished run. The server refuses while the parent has active or
  queued runs; a newer merge-back replaces a pending one.

Side chats are hidden from thread lists, search, the command palette, MCP
thread lists, and lineage graphs. Worktree cleanup treats a side chat as settled
when its parent is, since side chats have no settle control of their own. Idle
compaction skips side chats.

## Agent guidance

There is no side-chat instruction block in the provider system prompt. The
first turn's inline context carries upstream's framing. Side chats use the
normal MCP credentials and toolkit; `t3_thread_send` and `t3_thread_read` work
under the usual project and permission checks.

## Flagged lifecycle mismatches

- `schedule_task` can bind recurring work to a side chat, which has no sidebar
  presence. Prefer rejecting such bindings in a follow-up.
- `t3_thread_organize` can pin, snooze, settle, or archive a side chat. These have
  no useful presentation for a side chat.

## Verification boundaries

`SideChat.test.ts` covers opening before the parent has a stable run, the
first turn's inline context, `onlyIfUnused` deletion, the parent delete cascade,
the nested side chat refusal, and the digest cap. `WorktreeCleanup.test.ts`
covers a side chat following its settled parent. Right-panel and reopen tests
cover reconciliation that never reopens a closed tab, closed-tab history, and
skipping deleted side chats.
