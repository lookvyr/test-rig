import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PullRequestTargetInput } from "./tools.ts";

const decodeTarget = Schema.decodeUnknownSync(PullRequestTargetInput);

describe("pull request target repository", () => {
  it("rejects repository URLs with guidance to use the PR URL field", () => {
    for (const repository of ["https://github.com/owner/repo", "//github.com/owner/repo"]) {
      expect(() => decodeTarget({ repository, number: 123 })).toThrow(
        "Pass a full pull request URL in url instead.",
      );
    }
  });

  it("accepts repository paths used by each hosting provider", () => {
    for (const repository of ["owner/repo", "group/subgroup/repo", "org/project/_git/repo"]) {
      expect(decodeTarget({ repository, number: 123 })).toEqual({ repository, number: 123 });
    }
    expect(decodeTarget({ url: "https://github.com/owner/repo/pull/123" })).toEqual({
      url: "https://github.com/owner/repo/pull/123",
    });
  });
});
