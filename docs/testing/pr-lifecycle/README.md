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
