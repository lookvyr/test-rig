# Pull requests

Open **Pull requests** above Settings to browse pull requests for your saved
projects. You can also choose **Open pull requests** in the command palette.
Your thread list stays available while you review.

Press **Command–Option–P** to open this view. While here, hold **Command–Option**
to show shortcut badges on the first nine pull requests in the filtered list.
Press **1–9** with those modifiers held to select the corresponding pull request.
Numbering follows the displayed order across projects and updates with the filters.

**Command–1–9** still jumps to sidebar threads. Releasing Option while holding
Command switches the PR badges to the sidebar thread badges. Release the modifiers
or switch away from the app to hide them. On Windows and Linux, use **Ctrl** in
place of Command and **Alt** in place of Option. These bindings can be changed in
**Settings → Keybindings**.

The workspace supports GitHub using the GitHub CLI connection on the project's
environment. Enable GitHub in Settings → Source Control and authenticate the CLI
if prompted. A remote environment uses its own connection and repository paths.

Filter the queue by project, state, or your involvement, and search the loaded
results by title, number, author, repository, or URL. Use **Refresh** to fetch
current information. Either refresh button in the workspace updates both the
queue and the selected review, including check results and changed files. The
workspace tells you when results are incomplete.

After a pull request closes, refreshing removes it from the **Open** queue. Find
it under **Closed** or **All states** to continue reviewing. Its local notes and
linked conversation remain available.

Select a pull request to open **Summary**. It shows the title, state, author,
branches, full description, check counts, and changed-file totals. Expand
**Checks** to see individual results and links to their details. Expand folders
in the file tree to see where the changes are. Drag the panel divider to resize
the review, or expand it to fill the workspace. Browsing does not check out a
branch or create a thread.

Descriptions render Markdown headings, lists, task lists, tables, and supported
HTML, including expandable sections. Fenced code blocks with a language such as
`ts`, `typescript`, or `gherkin` use the same syntax highlighting, copy button,
and line wrapping as chat. Unknown languages remain readable as plain text.
Images appear as **View image** links that you can open explicitly.

**Diff** and **Activity** are coming soon. Use **Open in GitHub** to view the
complete diff, commits, comments, and reviews.

From the global workspace, **Choose review thread…** offers a **New PR worktree**
or an existing regular thread. Choosing a destination opens it immediately with
PR context and selected local notes in an unsent draft, preserving text already
in the composer. Add your instructions there and send when ready. Existing
threads keep their current checkout. The link changes only when the handoff
succeeds; dismissing the chooser leaves it alone.

Once linked, the **Review thread** row shows the destination. **Open** returns to
it without changing its draft. Use **Change…** to choose a different destination.

Expand **Local notes** to save feedback with the pull request and select which
notes to include. Notes retain the revision they describe; notes from an earlier
revision are marked as such. Existing notes, including earlier line references,
remain available. Notes stay on this client across navigation and restarts and
are not posted to GitHub or synchronized with other devices.

Inside the linked thread, pull request details remain available in the right
panel. **Add to message** appends selected notes and the current PR revision to
the composer. Review the message and send when ready. Adding feedback never
sends a message or changes the linked thread.

Side chats remain available through the conversation's normal controls. They
are not PR destinations and do not change the PR link.

This workspace does not publish reviews or merge pull requests. Use the pull
request link to open GitHub for those actions.
