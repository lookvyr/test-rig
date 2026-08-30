# Side chats

A side chat lets you explore a question using the current conversation’s context without adding the exchange to that conversation.

After starting a Codex or Claude conversation, enter `/side`, or open the right panel and choose **Side chat** from its **+** menu. Each conversation has one temporary side chat. Opening it again returns to the same side chat.

The side chat receives a snapshot of the parent’s context when it opens. Its visible conversation starts empty. You can send follow-up messages and images, run tools, answer questions, and stop its work independently. It starts with the parent’s model and permission settings; side chats do not introduce additional approval requirements.

Side chats use the same checkout as their parent. Both can work at the same time, and both see file changes made by either conversation. Their later messages are separate.

- Switching tabs, hiding the right panel, or closing its Side chat tab preserves the conversation and draft. Reopen it with `/side` or the **+** menu.
- **Keep as thread** turns that same conversation into a normal thread in the main list, preserving its context and work.
- **Discard side chat** stops its work and removes the temporary conversation. File changes remain.

Keep is unavailable while the side chat is opening or in an error state. If opening fails, discard it and try again. If a later turn fails, retry it before keeping the conversation.

Claude must save the current conversation snapshot before it can open a side chat. Opening can fail briefly while a response is being saved, or while context compaction is incomplete. After compaction, you may need to send another message in the parent first. Discard the failed side chat and open another when the parent is ready. Test Rig does not substitute an older snapshot or start an empty conversation.

Temporary side chats expire when Test Rig’s backend restarts. Closing a browser tab or reconnecting does not discard them. Keep a side chat if you want to return to it after a restart.

Checkpoint restoration is unavailable in a temporary side chat and in its parent while the side chat exists. Keep or discard the side chat before restoring the parent.

Side chats support Codex and Claude. OpenCode conversations do not offer them.
