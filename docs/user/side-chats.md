# Side chats

A side chat lets you explore a question using the current conversation’s context without adding the exchange to that conversation.

After the first Codex or Claude turn finishes, enter `/side`, or open the right panel and choose **Side chat** from its **+** menu. These options appear once a completed turn is available. Each conversation has one temporary side chat. Opening it again returns to the same side chat until you discard it.

You can start typing as soon as the side chat opens. Send becomes available when its context is ready.

The side chat receives a snapshot of the parent’s context when it opens. If the parent is working on another turn, the snapshot ends at the previous completed turn. Its visible conversation starts empty. You can send follow-up messages and images, run tools, answer questions, and stop its work independently. It starts with the parent’s model and permission settings; side chats do not introduce additional approval requirements.

Side chats use the same checkout as their parent. Both can work at the same time, and both see file changes made by either conversation. Their later messages are separate.

- Switching tabs or hiding the right panel preserves the conversation and draft. Return to it with `/side` or the **+** menu.
- Closing the Side chat tab with its **×**, the close-tab shortcut (**Ctrl+W** on Windows/Linux, **Cmd+W** on macOS), or a tab menu close action discards it. The shortcut closes the active right-panel tab when the panel is open; a focused terminal retains its own close shortcut.
- **Discard side chat** in the side-chat actions menu does the same thing. Discarding stops its work and removes the temporary conversation and draft. File changes remain. The next `/side` opens a fresh snapshot of the parent’s context.

The first discard asks for confirmation. Select **Don’t ask again** when confirming to skip future prompts across side chats in this app. Cancel leaves the conversation and that preference unchanged. You can turn confirmation back on in **Settings → General → Side chat discard confirmation**. Bulk tab-close actions also ask before discarding a side chat unless you disabled confirmation.

If opening fails, discard the side chat and try again.

Claude must save a complete conversation snapshot before it can open a side chat. Opening can fail briefly while a response is being saved, or while context compaction is incomplete. After compaction, you may need to send another message in the parent first. Discard the failed side chat and open another when the parent is ready. Test Rig does not start an empty conversation when a snapshot is unavailable.

Temporary side chats expire when Test Rig’s backend restarts. Closing a browser tab or reconnecting does not discard them.

Side chats support Codex and Claude. OpenCode conversations do not offer them.

Ask the side-chat agent to send findings to the parent or another chat in the same project. You do not need to keep the side chat first. The agent reports whether the message started a turn, steered active work, or was queued until delivery is possible. An accepted message remains in the receiving chat if you discard the side chat afterward. Sending does not mean the receiving agent has finished responding.
