# Pull requests

Open **Pull requests** above Settings to browse pull requests for your saved
projects. You can also choose **Open pull requests** in the command palette.
Your thread list stays available while you review.

The workspace supports GitHub using the GitHub CLI connection on the project's
environment. Enable GitHub in Settings → Source Control and authenticate the CLI
if prompted. A remote environment uses its own connection and repository paths.

Filter the queue by project, state, or your involvement, and search the loaded
results by title, number, author, repository, or URL. Use **Refresh** to fetch
current information. Either refresh button in the workspace updates both the
queue and the selected review, including new comments and changed files. The
workspace tells you when results are incomplete.

After a pull request closes, refreshing removes it from the **Open** queue. Find
it under **Closed** or **All states** to continue reviewing. Its local notes and
linked conversation remain available.

Select a pull request to inspect its description and checks in **Summary**, its
changed files in **Code**, and comments and reviews in **Timeline**. Browsing does
not check out a branch or create a conversation.

Add local notes to the pull request or a changed line. Select the notes you want
to include and edit the instructions before opening a conversation. Notes retain
the revision they describe; notes from an earlier revision are marked as such.
Notes and instructions remain on this client across navigation and restarts.
They are not posted to GitHub or synchronized with other devices.

From the global workspace, **Prepare agent draft** lets you choose a new
conversation in a worktree or an existing regular thread. **Open draft** adds the
PR context and selected notes to an unsent message, preserving text already in
the composer. Existing threads keep their current checkout. The link changes
only when the handoff succeeds; cancelling a destination choice leaves it alone.

Once linked, **Open conversation** returns to that conversation without changing
its draft. Use **Change conversation…** in the global workspace to choose a
different destination.

Inside the linked conversation, pull request details remain available alongside
Diff and Files. Select feedback from comments or reviews, or save local notes,
then choose **Add to message**. This adds the selected feedback and current PR
revision to this conversation's composer. Add your instructions there, review
the message, and send when ready. Refresh and repeat for subsequent review rounds.
Adding feedback never sends a message or changes the linked conversation.

Side chats remain available through the conversation's normal controls. They
are not PR destinations and do not change the PR link.

This workspace does not publish reviews or merge pull requests. Use the pull
request link to open GitHub for those actions.
