# Running Sightseer in the Background

On a Linux host, Sightseer can run as a background service for your user. It starts when the machine
boots and keeps running after you log out.

## Manage the Service

Install it with the latest Sightseer release:

```sh
npx @lookvyr/sightseer@latest service install
```

Check whether it is installed:

```sh
npx @lookvyr/sightseer@latest service status
```

Update or repair it:

```sh
npx @lookvyr/sightseer@latest service update
```

Stop it and remove it from startup:

```sh
npx @lookvyr/sightseer@latest service uninstall
```

Updating restarts Sightseer briefly. Let active agent work and terminal commands finish first.
If a remote update is already in progress, wait for it to finish before retrying a local update.

The systemd unit runs a small stable launcher. Exact Sightseer versions are installed separately, so
a failed remote candidate can return to the previous version without rewriting the unit. The
launcher snapshots the database before a remote candidate starts, so database updates roll back
with the server version. An older launcher may require one local `service update` before this is
available.

The background service currently requires Linux with systemd.
