# Side chats

A side chat lets you explore a question using the current conversation’s context without adding the exchange to that conversation.

After the first Codex or Claude turn finishes, enter `/side`, or open the right panel and choose **Side chat** from its **+** menu. These options appear once a completed turn is available. Each conversation has one temporary side chat. Opening it again returns to the same side chat.

The side chat receives a snapshot of the parent’s context when it opens. If the parent is working on another turn, the snapshot ends at the previous completed turn. Its visible conversation starts empty. You can send follow-up messages and images, run tools, answer questions, and stop its work independently. It starts with the parent’s model and permission settings; side chats do not introduce additional approval requirements.

Side chats use the same checkout as their parent. Both can work at the same time, and both see file changes made by either conversation. Their later messages are separate.

- Switching tabs, hiding the right panel, or closing its Side chat tab preserves the conversation and draft. Reopen it with `/side` or the **+** menu.
- **Discard side chat** stops its work and removes the temporary conversation. File changes remain.

If opening fails, discard the side chat and try again.

Claude must save a complete conversation snapshot before it can open a side chat. Opening can fail briefly while a response is being saved, or while context compaction is incomplete. After compaction, you may need to send another message in the parent first. Discard the failed side chat and open another when the parent is ready. Test Rig does not start an empty conversation when a snapshot is unavailable.

Temporary side chats expire when Test Rig’s backend restarts. Closing a browser tab or reconnecting does not discard them.

Checkpoint restoration is unavailable in a temporary side chat and in its parent while the side chat exists. Discard the side chat before restoring the parent.

Side chats support Codex and Claude. OpenCode conversations do not offer them.
