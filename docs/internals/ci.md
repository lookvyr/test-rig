# Local verification

> For maintainers. Using Sightseer? See [docs/user](../user/).

Sightseer intentionally retains no inherited GitHub Actions workflows. Builds,
tests, and checks run from source when they are needed; future CI will be added
from scratch only for Sightseer's use cases.

Use the smallest local proof for the change:

- `vp test run <files>` for focused tests
- `vp run --filter <workspace> typecheck` for the touched workspace
- `vp run build:desktop` for the desktop and bundled server pipeline
- `vp run test:desktop-smoke` for the packaged desktop shell boundary
- `vp run dist:desktop:*` to create a local installer when packaging changed

There is no npm publication, GitHub Release, signing, notarization, or automated
version-bump workflow.
