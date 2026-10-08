# Skills and provider commands

Type `$` in the composer to browse the selected provider’s skills. Type `/` to
browse its commands alongside Test Rig’s built-in commands.

The suggestions use the current chat’s repository, or its worktree when one is
attached. Switching repositories or worktrees updates the suggestions without
restarting Test Rig. Provider-wide skills remain available; when a provider lets
a repository override a skill with the same name, the repository’s version wins.

The directory used to start Test Rig does not choose the chat’s skills or
commands. Each configured provider instance uses its own settings and skills.
