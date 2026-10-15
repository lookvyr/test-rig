# Claude model catalog intake — October 14, 2026

Matched the Claude catalog to T3 Code nightly
[`v0.0.46-nightly.20261014.3132`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261014.3132)
(`5a4e99805337`). Only Claude catalog data and its local consumers were adapted;
the upstream provider package reorganization was not imported.

The current list is Fable 5.1, Opus 5.5, Sonnet 5.5, and Haiku 5.5. Their minimum
Claude Code versions are 2.1.257, 2.1.280, 2.1.284, and 2.1.293 respectively.
Older models remain selectable as legacy models. Test Rig defaults new chats
to Opus 5.5 and text generation to Haiku 5.5; saved selections remain intact.

The provider snapshot now reads the bundled manifest through the existing
Claude catalog resolver. Model visibility, legacy classification, capabilities,
defaults, CLI effort mappings, and API model IDs use the same catalog as the
native V2 adapter. This removes the separate hardcoded picker list and its
per-model version gates. Current profiles use a fixed 1M context window, so old
saved context options do not add an obsolete `[1m]` suffix to their API IDs.

Focused validation covers provider snapshots and version gates, aliases,
catalog resolution, CLI text generation, both Claude adapter paths, and model
option compilation. Server and contracts typechecks and lint on changed
TypeScript files passed. Installed Claude Code 2.1.300 exposes the full current
catalog in a local version-resolution check; live model turns and the packaged
desktop were not exercised.
