import { describe, expect, it } from "vite-plus/test";

import {
  parsePullRequestReference,
  pullRequestReferenceProviderKind,
} from "./pullRequestReference";

describe("parsePullRequestReference", () => {
  it("accepts GitHub pull request URLs", () => {
    expect(parsePullRequestReference("https://github.com/pingdotgg/t3code/pull/42")).toBe(
      "https://github.com/pingdotgg/t3code/pull/42",
    );
  });

  it("accepts raw numbers", () => {
    expect(parsePullRequestReference("42")).toBe("42");
  });

  it("accepts #number references", () => {
    expect(parsePullRequestReference("#42")).toBe("42");
  });

  it("accepts gh pr checkout commands with raw numbers", () => {
    expect(parsePullRequestReference("gh pr checkout 42")).toBe("42");
  });

  it("accepts gh pr checkout commands with #number references", () => {
    expect(parsePullRequestReference("gh pr checkout #42")).toBe("42");
  });

  it("accepts gh pr checkout commands with GitHub pull request URLs", () => {
    expect(
      parsePullRequestReference("gh pr checkout https://github.com/pingdotgg/t3code/pull/42"),
    ).toBe("https://github.com/pingdotgg/t3code/pull/42");
  });

  it("rejects non-pull-request input", () => {
    expect(parsePullRequestReference("feature/my-branch")).toBeNull();
  });
});

describe("pullRequestReferenceProviderKind", () => {
  it("identifies provider-specific URLs and checkout commands", () => {
    expect(pullRequestReferenceProviderKind("https://github.com/pingdotgg/t3code/pull/42")).toBe(
      "github",
    );
    expect(pullRequestReferenceProviderKind("glab mr checkout 42")).toBeNull();
    expect(pullRequestReferenceProviderKind("az repos pr checkout --id 42")).toBeNull();
  });

  it("leaves number-only references to the current repository provider", () => {
    expect(pullRequestReferenceProviderKind("#42")).toBeNull();
  });
});

it.each([
  "https://gitlab.com/group/project/-/merge_requests/42",
  "https://bitbucket.org/group/project/pull-requests/42",
  "https://dev.azure.com/acme/project/_git/repo/pullrequest/42",
  "glab mr checkout 42",
  "az repos pr checkout --id 42",
])("rejects unsupported checkout reference %s", (reference) => {
  expect(parsePullRequestReference(reference)).toBeNull();
  expect(pullRequestReferenceProviderKind(reference)).toBeNull();
});
