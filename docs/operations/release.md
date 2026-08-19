# Release Checklist

> For maintainers. Using Sightseer? See [docs/user](../user/).

This document covers the retained GitHub release workflow. Sightseer does not deploy a hosted web
application, relay, mobile push service, or account-provider infrastructure.

## Workflow

`.github/workflows/release.yml` runs for stable tags, scheduled nightly checks, and manual stable or
nightly dispatches. It:

1. runs lint, typecheck, and tests;
2. builds macOS arm64/x64, Linux x64, and Windows x64 desktop artifacts;
3. publishes the exact matching CLI package version;
4. publishes one GitHub Release containing the desktop artifacts;
5. aligns versions on `main` for stable releases.

Stable tags with a suffix are prereleases. Nightly releases use a dated prerelease version, publish
the CLI under the `nightly` dist-tag, and do not commit version bumps to `main`.

The CLI must be published before desktop artifacts become available. A desktop client may ask a
managed server to update to its exact version, so publishing the client first would expose an update
target that does not exist.

## Required release credentials

Stable finalization uses:

- `RELEASE_APP_ID`
- `RELEASE_APP_PRIVATE_KEY`

The workflow token publishes the GitHub Release. npm publishing uses OIDC trusted publishing
configured for `.github/workflows/release.yml`.

## Optional signing

Unsigned artifacts remain supported. Signed macOS builds require the certificate, notarization API
key, team ID, and provisioning profile variables consumed by the workflow. Signed Windows builds
require the Azure Trusted Signing variables and credentials consumed by the workflow.

The provisioning profile is packaging input only; Sightseer does not derive associated domains from
an account provider and does not add account/passkey entitlements.

## Validation

There is no dry-run release tag: accepted tags and manual release dispatches publish real artifacts.
Use focused local/CI checks to validate changes without shipping.

For a real release:

1. confirm `main` is green;
2. create and push the intended `vX.Y.Z` tag;
3. verify preflight, platform builds, CLI publication, and GitHub Release publication;
4. confirm `npm view <package>@<version> version` returns the exact client version;
5. smoke-test the downloaded desktop artifact and a server update from the previous compatible
   version.

When migration manifests differ, the remote update action must stop before restart and show the
exact local service-update command rather than attempting an unsafe automatic update.
