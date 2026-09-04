import assert from "node:assert/strict";
import test from "node:test";
import { summarizeReview } from "./review-summary.mjs";

test("reports the newest comment and number of changed files", () => {
  const summary = summarizeReview({
    title: "Review notification summary",
    state: "open",
    isDraft: false,
    files: ["summary.mjs", "summary.test.mjs", "examples.json"],
    comments: [
      { body: "Updated after review", createdAt: "2026-09-04T20:00:00Z" },
      { body: "Please check closed drafts", createdAt: "2026-09-04T19:00:00Z" },
    ],
  });
  assert.equal(summary.latestComment, "Updated after review");
  assert.equal(summary.filesChanged, 3);
  assert.equal(summary.status, "open");
});
