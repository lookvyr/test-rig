# Projects with several repositories

A project can cover more than one repository, so one thread can read and change all of them. This
fits three common setups:

- A plain folder that holds several repositories, such as `shop/api` and `shop/web`.
- A repository that works alongside others it depends on, anywhere on the machine.
- A repository with submodules.

The project folder does not have to be a Git repository itself.

## Which repositories a project covers

There is no list to keep. A project covers every repository inside its folder: Test Rig looks one
level down, and one level further inside folders that are not repositories themselves, such as
`src` or `packages`. Hidden folders and `node_modules` are skipped. It reads the disk each time, so
a repository you clone there is part of the project straight away, and one you delete is gone from
it. Worktrees of another repository are left out.

**Settings → Projects → Repositories** shows what the project covers on each machine.

### Folders outside the project

A folder somewhere else on the machine has to be added, because adding it lets agents work in a
place they could not reach before.

- Under **Repositories**, enter its path and choose **Add**, or choose **Browse…** on desktop.
- If the project folder has a `.code-workspace` file, the folders it lists outside the project are
  offered there with an **Add** button.

**Remove** takes an added folder out of the project. It never deletes files. Added folders are
paths on one machine, so the same project on another machine has its own. A project can have up to
128 added folders.

### Leave a repository out

To keep a repository inside the project folder out of the project, name it in the `t3.json` in the
project folder, relative to that folder:

```json
{
  "ignoreRepositories": ["vendor/big"]
}
```

It is then not reviewed on its own and gets no worktree. Because the file is checked in, the choice
applies on every machine.

### Submodules

A thread that changes a submodule shows it as its own repository, with its own diff and Git
actions, while the repository that holds it shows the changed pin.

## What agents see

Codex and Claude are told which folders and repositories the thread covers, and may write in the
folders you added. Each repository keeps its own history, so agents commit in each one separately.

## Review changes

Each turn lists the files it changed in every repository, each under the folder it sits in, so
`api/src/app.ts` and `web/src/app.ts` stay apart. The turn's diff covers all of them.

The Diff pane's **Uncommitted**, **Branch** and **Committed** views read one repository at a time.
Pick it from the repository picker at the top of the pane. The picker lists every repository the
thread reaches, including ones no turn has touched, so edits you made by hand show up too.

## Commit, push, and open pull requests

Git actions run in one repository at a time.

The thread details panel lists the repositories the thread changed, most recent first, each with
its branch and uncommitted changes. Expand one to commit, push, or open a pull request there.
**Other repositories...** adds any other repository of the project to that thread's list until you
reload; expand it and choose **Remove from this thread** to take it off again.

A pull request opened in a repository, or already open for its branch when a turn ends, is linked
to the thread.

## Worktree threads

**New worktree** works for these projects too, even when the project folder is not a repository.
The thread gets its own folder laid out like the project, and each repository you choose gets a
worktree there, all on the thread's branch.

Choose the repositories with the repositories control next to the workspace picker before you
send. Every repository is included when the project covers eight or fewer; with more, none is
included until you choose. Your last choice is remembered for the project in that browser. To
bring another repository into a running thread, pick it under **Other repositories...** in the
thread details panel.

If a repository already has a branch with the thread's name, the thread takes the next name free
in all of them, such as `fix-login-2`. Each repository starts from the thread's base branch where it has a branch of that name, locally
or on origin, and from its own default branch otherwise. A repository with no commit yet is left
out, since it has nothing to branch from. A plain folder has no branch picker, so you name the
base branch at the bottom of the repositories control.

In a plain folder, the files outside your repositories are shared links to the originals, not
copies. Editing one changes it for every thread. Repositories you did not choose are left out of
the thread's folder.

Deleting a worktree thread with its worktree removes every repository's worktree. If you
confirm removing it anyway with uncommitted changes, files the thread created outside its
repositories go too; the shared originals the folder links to are never touched.

Automatic worktree cleanup in **Settings → Worktrees** treats these folders like any other worktree
when a thread settles or has been inactive long enough, but checks each repository on its own: a
repository with local work keeps its worktree, and the others are removed. Merged and unchanged
rules compare one branch with one default branch, so they never remove these folders. When the
thread resumes, the next message lays its folder out again, with each repository's worktree back on
the thread's branch.

An agent can move its thread into such a folder too, with the worktree handoff tool, and can read
which repositories a project covers before it starts a worktree thread.

## Limits

- One Git action runs in one repository. There is no commit or push across several at once.
- Only the project folder's `t3.json` is read. Setup scripts and actions inside one of its
  repositories are not picked up.
- A worktree thread whose whole folder is deleted outside Test Rig is not laid out again; a folder
  that lost only some of its worktrees gets them back on the next message.
- Conversation rewind is not available, so nothing here restores files; fork from an earlier
  response instead.
- Custom worktree layouts, for projects that need to build a thread's folder with their own
  script, are not supported.
