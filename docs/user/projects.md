# Projects

Choose **New project** from the sidebar or command palette, enter a name, and
review its directory before creating it. Test Rig creates a local folder and Git
repository, then opens a new conversation there. Creating a project does not
publish it.

To work with an existing folder or clone a repository, use **Add project** and
choose the corresponding source.

New drafts use the destination project's defaults. Changing a draft's project
keeps its prompt and attachments. Model and permission choices you made explicitly stay selected; automatic
selection follows the destination project's defaults. Close draft
terminals before changing projects so their shells stay in the workspace where
they started.

Worktree removal checks for uncommitted tracked changes and nonignored untracked
files, even if your Git settings hide untracked files from status. Files covered
by Git ignore rules, such as ignored dependencies and build output, do not block
removal.
