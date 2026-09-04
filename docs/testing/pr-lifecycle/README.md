# PR lifecycle review fixture

This self-contained fixture exercises a realistic review across code, tests,
example data, and documentation. It is not wired into the Test Rig product.

Run `node --test docs/testing/pr-lifecycle/review-summary.test.mjs`.

Review focus:
- Preserve latest-comment ordering even when input is unordered.
- Check how a draft is displayed after the pull request closes.
- Keep local line notes anchored to the revision they reviewed.

The test PR will receive comments and a follow-up commit, then be closed without
merging. All content is synthetic.

## Review round 2

Closed state now takes precedence over the draft flag and has a regression test.
The example data is named `examples.json`; the temporary checklist was removed.
Verify that the workspace shows four files after refresh and marks first-revision
local notes as belonging to an older revision.
