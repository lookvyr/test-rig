# Projects

Choose **New project** from the sidebar or command palette, enter a name, and
review its directory before creating it. Test Rig creates a local folder and Git
repository, then opens a new conversation there. Creating a project does not
publish it.

To work with an existing folder or clone a repository, use **Add project** and
choose the corresponding source. A clone is suggested at `<starting folder>/<repo>`; turn on
**Settings → Threads → Clone into host folders** to use `<host>/<owner>/<repo>`
folders, like ghq.

New drafts use the destination project's defaults. Changing a draft's project
keeps its prompt and attachments. Model and permission choices you made explicitly stay selected; automatic
selection follows the destination project's defaults. Close draft
terminals before changing projects so their shells stay in the workspace where
they started.

Worktree removal checks for uncommitted tracked changes and nonignored untracked
files, even if your Git settings hide untracked files from status. Files covered
by Git ignore rules, such as ignored dependencies and build output, do not block
removal.

If a worktree launch encounters a concurrent Git reference update, Test Rig retries
the fetch once automatically.

## Settings for one project

The **Threads**, **Browser**, **Source control**, **Worktrees**, and
**Maintenance** settings pages start with **Applying settings for All
projects**. Choose a project there to give it its own value for settings a
project can override, such as the default model, branch naming, title
instructions, or auto-settle rules. The project keeps inheriting every value
you leave alone. A layers marker next to a setting shows where its current
value comes from; use the row's reset control to drop the project's override.
Settings that belong to the whole environment, such as background activity,
are read-only while a project is selected.

When you connect more than one environment, the same sentence also lets you
choose an environment, or a single checkout when a project has several on one
environment. Changes made with **All environments** selected save to every
connected environment.
