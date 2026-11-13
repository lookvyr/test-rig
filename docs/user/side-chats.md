# Side chats

A side chat lets you ask a question about a conversation without adding to it. It starts with what the conversation knows, and the conversation keeps working while you ask.

## Start a side chat

Start a message with `/side` or `/btw`, then your question, and send it. The side chat opens as a tab in the right panel and sends your question right away. The question must be text only; remove images, files, and other context first.

Send `/side` on its own, or choose **Side chat** from the right panel's **+** menu, to open an empty side chat.

Side chats are available after the conversation's first message, including while it is still working. A side chat cannot start another side chat.

## What a side chat knows

A side chat starts with the conversation's context, plus a summary of what the conversation has done since its last finished turn. You can ask it to look up the conversation's latest state at any time.

It starts with the model, reasoning level, and permissions shown in the conversation's composer, and its first reply uses them. Before you send its first message, you can pick any model or provider for it. Later changes in the conversation do not change existing side chats.

A side chat works in the same folder as its conversation. Both can work at the same time, and both see file changes made by either one.

## Find a side chat again

Side chats do not appear in the sidebar. Every side chat a conversation has is listed under **Side chats** in thread details, with a count of the ones still working. Choose one to open its tab.

When a side chat needs an approval or an answer, its tab, the conversation, and the conversation's row in the sidebar show it. You can approve from the conversation without switching tabs.

Side chats are saved like any other conversation and remain after Test Rig restarts.

## Bring back what you learned

Choose **Bring back** at the top of a side chat to add the side chat's conversation to your next message in the main conversation. Nothing is sent until you send that message, so you can say what to do with it. Bring back is available when the main conversation is idle and the side chat has a finished reply. Bringing back again, from this or another side chat, replaces the earlier one.

The side chat stays open afterward. You can also ask the side chat's agent to send a message to the main conversation directly.

## Close and delete

Close a side chat tab with its **×**, the close-tab shortcut (**Ctrl+W** on Windows/Linux, **Cmd+W** on macOS) while the right panel is focused or open, or **Close** at the top of the side chat. Closing keeps the side chat; reopen it from thread details or with the reopen-closed-tab shortcut. A side chat you never sent a message in is deleted when you close it.

To delete a side chat you used, choose **Delete** at the top of the side chat. It asks first unless you turned off delete confirmation in **Settings → General**. Deleting a side chat does not undo its file changes or take back messages it already sent to other conversations.

Deleting a conversation also deletes its side chats.

Side chats support Codex and Claude.
