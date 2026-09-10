# Source control

Test Rig uses Git for local repository work and can connect to a hosting provider for pull requests, repository lookup, cloning, and publishing.

Git and hosting providers are separate. Disabling a GitHub, GitLab, Azure DevOps, or Bitbucket integration stops Test Rig from checking credentials or making requests to that provider. It does not disable Git commands against remotes already configured in a repository.

## Provider switches

Open **Settings** → **Source Control** to enable or disable each hosting integration.

| Provider     | Default  | Authentication                        |
| ------------ | -------- | ------------------------------------- |
| GitHub       | Enabled  | GitHub CLI                            |
| GitLab       | Disabled | GitLab CLI                            |
| Azure DevOps | Disabled | Azure CLI with the DevOps extension   |
| Bitbucket    | Disabled | Access token, or email plus API token |

When an integration is disabled:

- Test Rig does not run its discovery or authentication checks.
- Provider-specific clone, publish, and pull-request actions are unavailable.
- Provider requests fail before Test Rig invokes the provider CLI or API.

Enable an integration before using any of its features. Test Rig scans it after the setting changes. Use the rescan button in **Settings** → **Source Control** after installing a CLI, signing in, or changing credentials.

Settings belong to the server environment that owns the repository. If you use more than one environment, configure each one separately.

## Generated writing defaults

Open **Settings** → **Source Control** to choose a writing style for generated commit messages and change requests. You can also add separate instructions for commit messages, change request titles, and change request descriptions. These are global defaults for every project in the current environment.

Repository conventions includes recent commit subjects and local `AGENTS.md` instructions. When Claude is the selected writer, it also includes local `CLAUDE.md` instructions. Test Rig adds these files to its writing prompt only when Repository conventions is selected.

PR descriptions have no built-in section headings. Your writing instructions determine the structure; without a requested structure, Test Rig asks for concise prose. **Follow change request templates** is independent of the writing style: when enabled and a template is found, that template supplies the structure.

Additional writing instructions fine-tune the selected style and take precedence when the two conflict. When following a repository change request template, description instructions can change the writing inside the template but do not replace its structure.

## Git is separate

Git status, diffs, branches, worktrees, checkpoints, fetches, pulls, and pushes do not depend on a hosting-provider switch. They use the repository's configured Git remotes and credentials.

Test Rig refreshes remote branch status in the background. The default fetch interval is 30 seconds. Change it in **Settings** → **Source Control** → **Git** → **Fetch interval**. Set the interval to `0` if Git should contact remotes only after an explicit action.

The background-activity policy can pause a scheduled fetch while the machine is locked, on battery, or in another restricted state. The fetch interval controls how often a refresh becomes eligible to run.

After a turn finishes on a feature branch, Test Rig checks again for a newly created pull request. This follows the hosting-integration and background-activity settings and does not trigger an extra Git fetch.

## Refreshing workspace views

The review panel uses the selected thread's checkout, including projects stored outside the folder where Test Rig was built or started. Its header identifies the project and current branch.

Choose the changes to inspect:

- **Uncommitted** combines staged, unstaged, and untracked files that Git does not ignore.
- **Unstaged** compares the working files with the Git index, including untracked files.
- **Staged** shows exactly what is currently in the Git index.
- **Branch** compares committed changes with the merge base of a branch you choose. You can choose a base even when automatic detection cannot find one.
- **Committed** shows a selected commit. Choose from recent commits or enter a commit SHA or ref. Merge commits compare against their first parent.
- **Latest turn** follows the newest completed turn. **Turn** keeps a particular turn selected. Turn reviews compare checkpoint snapshots; they are not a claim that every change was authored by the agent.

Use **Show changed files** to search paths and navigate the changed-file tree. The tree stays beside the diff in a wide panel and opens over it in a narrow panel. Arrow keys browse files; Enter opens the selected file and closes the narrow file list. Previous/next controls also move between files. Selecting a collapsed file expands it.

Small reviews show a continuous diff. Large Git reviews show one file at a time while keeping the complete changed-file list available. A file that exceeds the preview limit is marked individually. Split/stacked views, line wrapping, whitespace filtering, syntax colors, and line comments remain available.

Use **Stage** or **Unstage** beside a file to change its index state. **Stage all** and **Unstage all** apply to the files in the current review scope. Staging a file includes all its current changes; hunk selection is not available here.

The review header's **Commit** action commits only staged changes. Its confirmation lists the staged files, and later unstaged edits in those files remain untouched. This differs from the general chat Git menu, which still offers its existing file-selection workflow. After committing, **Push** sends existing commits to the configured remote.

The Files panel and current workspace diff refresh after the active thread finishes a turn. Refreshes keep the file tree's expanded folders and the diff's scroll position and collapsed files. The Files refresh button also reloads the open text file. Pending edits in the file editor remain protected while a refresh runs.

Use **Expand all folders** beside the Files search button to open every folder in the tree. Once all folders are expanded, the button becomes **Collapse all folders**. Collapsing folders keeps your selected file open.

## Copy a diff file path

Use the copy button beside a filename in the diff panel to copy its repository-relative path. Renamed files use the new path; deleted files use their former path.

## Worktree branch names

Set the prefix for new worktree branches under **Settings** → **General** → **New threads** →
**Worktree branch prefix**. The default is `test-rig`.

With `example/team`, Test Rig creates `example/team/_worktree/a1b2c3d4`, then renames it after the first prompt, for example to `example/team fix-reconnect-backoff`. If naming fails, the temporary branch still works. Its folder keeps the temporary name.

The setting applies only to new worktrees. It does not rename existing branches or folders, or
affect synthetic branches for cross-repository pull requests.

When **Start from origin** is enabled for a new worktree, Test Rig fetches origin and uses the selected branch there. If origin or that branch is absent, it uses the selected local branch. A fetch failure is reported instead of silently using stale local state.

## Available provider actions

With the matching integration enabled and authenticated, Test Rig can:

- Look up and clone a hosted repository.
- Publish a local repository and add its remote.
- Create a pull request or merge request from the current branch.
- Find an existing pull request or merge request and open it in the browser.
- Check out a change request for local review.

You can always clone by pasting a full Git URL. This uses Git directly rather than provider discovery.

## Set up GitHub

Install GitHub CLI 2.81.0 or newer and sign in on the machine running the Test Rig environment:

```bash
brew install gh
gh auth login
```

GitHub is enabled by default. Open **Settings** → **Source Control** to check its status or turn it off.

## Set up GitLab

Install the GitLab CLI and sign in:

```bash
brew install glab
glab auth login
```

Enable GitLab in **Settings** → **Source Control**, then rescan.

## Set up Azure DevOps

Install Azure CLI, add the DevOps extension, and sign in:

```bash
brew install azure-cli
az extension add --name azure-devops
az login
```

Enable Azure DevOps in **Settings** → **Source Control**, then rescan.

## Set up Bitbucket

Bitbucket reads credentials from environment variables on the machine running the Test Rig environment. These variable names retain their inherited `T3CODE_` prefix.

Use a Bitbucket access token:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or use an Atlassian account email and API token with repository and pull-request access:

```bash
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

The access token takes precedence when both forms are configured. Restart the Test Rig environment after changing these variables, enable Bitbucket in **Settings** → **Source Control**, then rescan.

## Troubleshooting

- A disabled provider has no authentication status. Enable it before rescanning.
- If a CLI is installed but the status is unavailable, make sure it is on the server process's `PATH`, then restart Test Rig and rescan.
- If a provider reports that it is not authenticated, run its login command on the machine hosting the environment. Signing in on the browser device does not configure the server.
- If GitHub says it could not verify sign-in status, update `gh` to 2.81.0 or newer and rescan.
- Provider authentication and Git remote authentication are separate. A provider CLI can be signed in while an SSH or HTTPS Git remote still needs its own credentials.
- If background fetches prompt for credentials or a security key, set the Git fetch interval to `0` and use explicit Git actions.

Provider documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)

Browse GitHub pull requests across your projects from **Pull requests** above
Settings. See [Pull requests](./pull-requests.md) for local review notes and
opening an unsent conversation draft.
