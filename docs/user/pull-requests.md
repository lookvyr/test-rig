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

Use the external-link button at the right of a pull request row to open it directly
in GitHub in your browser. Selecting the rest of the row opens its review in Test Rig.

After a pull request closes, refreshing removes it from the **Open** queue. Find
it under **Closed** or **All states** to continue reviewing.

Select a pull request to open its details. It shows the title, state, author,
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

Use **Open in GitHub** to view the complete diff, commits, comments, and reviews.

Choose **Review** beside the GitHub link on a pull request row to prepare a worktree on its
branch and open a new thread draft containing only the PR link. An existing
worktree for that PR branch is reused when available. Add your instructions and
send when ready. Starting a thread does not wait for the details panel to load
and does not automatically open that panel.

Return to your review through the normal thread list. Each new review gets its
own draft; the PR page does not designate a linked review thread.

Reviews of the same PR can share a worktree, so file changes are visible to every
thread using it. Reusing a worktree preserves local edits; it does not pull newer
PR commits or rerun project setup. If the PR branch is checked out in the main
project checkout, switch that checkout to another branch before choosing **Review**.

When a thread's checkout has a detected GitHub PR, **Show PR details** in the
thread header opens its description, checks, and file tree. You can also add
**Pull request** from the right panel's add menu. This works for ordinary
coding threads as well as threads started from the PR page. Detection may take
a moment after checkout. By default, the panel and PR badge follow the PR detected for the thread's branch.
Pasting another PR link into a message does not change the association.

Right-click the PR badge in the sidebar or below the composer and choose
**Unlink PR from thread** to stop automatic detection for that thread. This choice
survives app restarts and branch changes. To link again, open the thread's menu
and choose **Link PR**, then enter a PR number or URL from the project's repository.
An explicit link stays attached even when the checkout changes. The same dialog
can remove an explicit link if its badge is unavailable.

Linked PRs continue to settle inactive threads when they merge or close, subject
to the usual pin, active-work, and manual settlement settings. Unlinking stops
PR-based settlement; ordinary inactivity settlement still applies.
If no PR is detected, an already-open panel offers **Refresh Git status**.

This workspace does not publish reviews or merge pull requests. Use the pull
request link to open GitHub for those actions.
