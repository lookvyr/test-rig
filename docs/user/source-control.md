# Source control

Sightseer uses Git for local repository work and can connect to a hosting provider for pull requests, repository lookup, cloning, and publishing.

Git and hosting providers are separate. Disabling a GitHub, GitLab, Azure DevOps, or Bitbucket integration stops Sightseer from checking credentials or making requests to that provider. It does not disable Git commands against remotes already configured in a repository.

## Provider switches

Open **Settings** → **Source Control** to enable or disable each hosting integration.

| Provider     | Default  | Authentication                        |
| ------------ | -------- | ------------------------------------- |
| GitHub       | Enabled  | GitHub CLI                            |
| GitLab       | Disabled | GitLab CLI                            |
| Azure DevOps | Disabled | Azure CLI with the DevOps extension   |
| Bitbucket    | Disabled | Access token, or email plus API token |

When an integration is disabled:

- Sightseer does not run its discovery or authentication checks.
- Provider-specific clone, publish, and pull-request actions are unavailable.
- Provider requests fail before Sightseer invokes the provider CLI or API.

Enable an integration before using any of its features. Sightseer scans it after the setting changes. Use the rescan button in **Settings** → **Source Control** after installing a CLI, signing in, or changing credentials.

Settings belong to the server environment that owns the repository. If you use more than one environment, configure each one separately.

## Git is separate

Git status, diffs, branches, worktrees, checkpoints, fetches, pulls, and pushes do not depend on a hosting-provider switch. They use the repository's configured Git remotes and credentials.

Sightseer refreshes remote branch status in the background. The default fetch interval is 30 seconds. Change it in **Settings** → **Source Control** → **Git** → **Fetch interval**. Set the interval to `0` if Git should contact remotes only after an explicit action.

The background-activity policy can pause a scheduled fetch while the machine is locked, on battery, or in another restricted state. The fetch interval controls how often a refresh becomes eligible to run.

## Available provider actions

With the matching integration enabled and authenticated, Sightseer can:

- Look up and clone a hosted repository.
- Publish a local repository and add its remote.
- Create a pull request or merge request from the current branch.
- Find an existing pull request or merge request and open it in the browser.
- Check out a change request for local review.

You can always clone by pasting a full Git URL. This uses Git directly rather than provider discovery.

## Set up GitHub

Install the GitHub CLI and sign in on the machine running the Sightseer environment:

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

Bitbucket reads credentials from environment variables on the machine running the Sightseer environment. These variable names retain their inherited `T3CODE_` prefix.

Use a Bitbucket access token:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or use an Atlassian account email and API token with repository and pull-request access:

```bash
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

The access token takes precedence when both forms are configured. Restart the Sightseer environment after changing these variables, enable Bitbucket in **Settings** → **Source Control**, then rescan.

## Troubleshooting

- A disabled provider has no authentication status. Enable it before rescanning.
- If a CLI is installed but the status is unavailable, make sure it is on the server process's `PATH`, then restart Sightseer and rescan.
- If a provider reports that it is not authenticated, run its login command on the machine hosting the environment. Signing in on the browser device does not configure the server.
- Provider authentication and Git remote authentication are separate. A provider CLI can be signed in while an SSH or HTTPS Git remote still needs its own credentials.
- If background fetches prompt for credentials or a security key, set the Git fetch interval to `0` and use explicit Git actions.

Provider documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)
