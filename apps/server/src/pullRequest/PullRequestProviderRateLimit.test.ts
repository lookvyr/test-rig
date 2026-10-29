import { assert, it } from "@effect/vitest";

import * as GitHubApi from "../sourceControl/GitHubApi.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import { gitHubProviderFailure } from "./GitHubPullRequestProvider.ts";

it("classifies rate limits from the GitHub pull-request provider", () => {
  assert.deepStrictEqual(
    gitHubProviderFailure(
      new GitHubApi.GitHubApiRateLimitError({ host: "github.com", operation: "read" }),
    ),
    { reason: "rate-limited" },
  );
});

it("keeps GitHub's exact retry time", () => {
  assert.deepStrictEqual(
    gitHubProviderFailure(
      new SourceControlRateLimit.SourceControlRateLimitPausedError({
        provider: "github",
        host: "github.com",
        retryAt: 1_786_802_400_000,
      }),
    ),
    { reason: "rate-limited", retryAt: 1_786_802_400_000 },
  );
});
