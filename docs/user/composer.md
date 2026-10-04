# Composer drafts and stashed prompts

## Markdown while editing

The composer renders headings, bullet and numbered lists, blockquotes, bold,
italic, strikethrough, and inline or fenced code as you type or paste Markdown.
Fenced code uses syntax highlighting when its language is supported. Drafts and
sent prompts remain Markdown, and copying formatted content copies Markdown.
Links, tables, and task checkboxes remain literal Markdown in the composer.

**Enter sends the prompt**, including from a list or code block. **Shift+Enter**
continues the current list or inserts a line in code. Use Shift+Enter on an empty
list item to leave the list; in code, use it after two trailing blank lines to
continue below the block. **Tab** accepts a file, skill, or command suggestion.
File and skill references inside code remain literal text.

## Threads without a project

Choose **No project** in the new-thread project picker, click **or start without a
project** under the heading, or use **New thread without a project** in the command
palette. The shortcut is **Cmd+Alt+N** on macOS or **Ctrl+Alt+N** elsewhere. You can
also start without a project from the empty welcome screen.

Each conversation gets its own folder under `~/.test-rig/scratch`. The agent,
terminal, and file browser use that folder. The folder is ready before you open
a terminal or browse files, including before the first message. These threads have no Git branch,
worktree, checkpoints, or turn diffs. Deleting a conversation keeps its files.

Before sending, you can switch between **No project** and a project using the
heading's picker without losing the prompt. If the draft has terminals, trying
to change projects explains that you need to close them first. Changing projects
never moves or restarts a running shell. If an older draft has
terminals in its previous workspace, Test Rig keeps them running and asks you to
close them before preparing the new folder. Existing conversations cannot be
moved into a project.

This option is unavailable if the app's data directory is inside a Git repository.

## Effort and speed

The effort menu closes after you select any option, including effort level or
speed. Reopen it to change another option. This also applies to model options in
Settings.

## Drafts and stashes

The new-thread heading gives longer project names more room and adapts to the
space left by open sidebars. Hover over a shortened name to see the full name.

Text and attachments entered while a new thread's worktree is being prepared
remain in the composer when setup finishes.

When you leave a thread with unsent text or attached context, an amber pen marks
it in the sidebar. The marker disappears when you return to that thread or clear
its composer. Changing a model or another thread setting alone does not mark a
thread as having an unsent draft.

Press **Cmd+S** on macOS or **Ctrl+S** elsewhere to stash the current prompt and
images. With an empty composer and exactly one ready stashed prompt, press the
shortcut again to restore it directly. If there are several entries or images
are still being prepared, the shortcut opens the stash menu. You can always open
that menu from the stash badge, navigate with the arrow keys, and restore with
Enter. Custom keybindings for the stash action also use this behavior.

## Moving between turns

When you leave a running thread, its next completion shows an unread indicator
in the sidebar, including its first reply. Opening the completed thread clears
that indicator. Switching to a different provider's thread does not mark the
background thread as read.

In a conversation with multiple turns, move the pointer beside the conversation
minimap to reveal **Previous turn** and **Next turn**. These move from your current
reading position to the adjacent user message. A control is disabled when there
is no turn in that direction; **Next turn** also stops at the end of the conversation. You can still select a minimap marker to jump
directly to a particular turn.

The controls share the minimap's side gutter and appear when there is room beside
the conversation.

## Conversation history and Find

Long conversations open with their recent turns. Choose **Load earlier turns** at
the top to read further back. A turn stays together with its tool activity.

Press **Cmd+F** on macOS or **Ctrl+F** elsewhere to find text throughout the
conversation, including earlier turns that have not loaded yet. Previous and
next match controls move between results. Closing Find returns to the recent
conversation view.

Tool details show the input, status, and command exit code when available. Raw
tool output is omitted from the conversation details.

## Continue from an earlier response

Choose **Fork from this response** to start a separate conversation from an
earlier response. The fork opens with history through that response; later turns
in the original conversation are excluded. Continue in the fork or use **Open
parent thread** to return to the original. Both chats remain available after
reloading. Forks do not merge conversation context back into their parent.

A fork is a durable chat, separate from a temporary `/side` conversation.
Forking a conversation does not create a Git worktree or isolate file changes.
Test Rig does not rewind conversations or edit sent messages; use a fork to try
another direction. Checkpoint diffs remain available for reviewing file changes.
