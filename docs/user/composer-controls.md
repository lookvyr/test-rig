# Composer controls

New chats start with the provider, model, and reasoning effort from the last chat you started in this browser or desktop profile, including when you switch projects. The remembered choice updates after the first message is accepted; browsing older chats, changing an unsent draft, and sending follow-ups do not change it.

Each model also remembers the effort you last chose for it. Picking that model again, from the list or from **Favorites**, brings back that effort, so switching between Opus at High and Sonnet at Low keeps each at its own level. A model you have not set an effort for keeps the current one. This memory does not change what new chats start with.

Speed starts at **Normal** (or **Standard**) for each new chat. Choose a faster speed in that chat when you want it. Existing chats and choices you explicitly made in an unfinished draft are preserved.

The composer's bottom row has **Attach images** (the paperclip) on the left. On the right, the model button shows the provider, model, and effort, such as **Opus 5.5 High**, followed by Send. Open the model button to change the model, its effort, other model options, speed, and the thread's permission mode. A separate permissions button appears next to it only while the thread's mode differs from your default. On narrow windows, **More composer controls** (…) holds the permission modes and, when enabled, plan mode.

Below the composer, a new thread shows its branch, worktree, and permission mode. After the first message that strip hides; turn on **Settings** → **Appearance** → **Composer context** to keep branch and worktree controls there.

Claude’s effort column offers explicit effort levels and the Ultracode option. To request deeper reasoning for one message, you can type `ultrathink` in the prompt; it does not change the selected effort level.

During a turn, the send arrow becomes **Steer message**. A follow-up changes the active turn. If the provider is still starting or cannot accept steering yet, the button explains that it is waiting. **Stop generation** remains available while you prepare a follow-up.

After stopping a turn, an empty composer offers **Resume thread**. Resume continues the stopped work. Typing a new message instead uses the ordinary send action. Resume is unavailable while a pending request still needs to be resolved.

Open the context gauge to see token usage and choose **Compact context** for a provider that supports it. Compaction leaves your unsent draft and attachments intact. You can also find `/compact` in that provider's command menu. Finish the active turn or resolve its blocking request before compacting.

Use the paperclip **Attach images** button at the left of the bottom row, paste, or drag an image into the composer. Existing files in the workspace can be referenced with `@`.

With an empty composer, press **Arrow Up** to recall your previous sent text. Press **Arrow Down** to move forward through the recalled prompts and return to an empty composer. Editing the recalled text ends browsing. Recall omits attached context and does not replace a draft that already contains text, images, or other references.

At the start of bold, italic, or inline code text, press **Arrow Left** to type before the formatting. At its end, press **Arrow Right** to type after it. The opposite arrow moves back into the formatting without inserting a space.

Click a question's header to hide or show its options. The next question opens automatically. Number shortcuts work while its options are visible. If the provider process is gone, the question explains why an answer cannot be submitted; interrupt or restart the run to recover.
