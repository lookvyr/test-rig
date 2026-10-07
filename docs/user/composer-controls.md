# Composer controls

During a turn, the send arrow becomes **Steer message**. A follow-up changes the active turn. If the provider is still starting or cannot accept steering yet, the button explains that it is waiting. **Stop generation** remains available while you prepare a follow-up.

After stopping a turn, an empty composer offers **Resume thread**. Resume continues the stopped work. Typing a new message instead uses the ordinary send action. Resume is unavailable while a pending request still needs to be resolved.

Open the context gauge to see token usage and choose **Compact context** for a provider that supports it. Compaction leaves your unsent draft and attachments intact. You can also find `/compact` in that provider's command menu. Finish the active turn or resolve its blocking request before compacting.

Use the paperclip **Attach images** button, paste, or drag an image into the composer. Existing files in the workspace can be referenced with `@`.

With an empty composer, press **Arrow Up** to recall your previous sent text. Press **Arrow Down** to move forward through the recalled prompts and return to an empty composer. Editing the recalled text ends browsing. Recall omits attached context and does not replace a draft that already contains text, images, or other references.

At the start of bold, italic, or inline code text, press **Arrow Left** to type before the formatting. At its end, press **Arrow Right** to type after it. The opposite arrow moves back into the formatting without inserting a space.

Click a question's header to hide or show its options. The next question opens automatically. Number shortcuts work while its options are visible. If the provider process is gone, the question explains why an answer cannot be submitted; interrupt or restart the run to recover.
