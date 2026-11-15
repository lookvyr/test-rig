import { describe, expect, it, vi } from "vite-plus/test";

import {
  openPullRequestLink,
  projectForPullRequestUrl,
  PullRequestLinkOpenError,
} from "./openPullRequestLink";

describe("openPullRequestLink", () => {
  it("opens the requested pull request URL", async () => {
    const openExternal = vi.fn(async () => undefined);
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123";

    await openPullRequestLink({ openExternal }, targetUrl);

    expect(openExternal).toHaveBeenCalledExactlyOnceWith(targetUrl);
  });

  it("reports bridge failures with a safe target origin", async () => {
    const cause = new Error("desktop shell unavailable");
    const targetUrl = "https://github.com/pingdotgg/t3code/pull/123?token=secret";
    const openExternal = vi.fn(async () => Promise.reject(cause));

    const result = openPullRequestLink({ openExternal }, targetUrl);

    await expect(result).rejects.toEqual(
      new PullRequestLinkOpenError({
        targetOrigin: "https://github.com",
        cause,
      }),
    );
    await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("secret"));
  });
});

describe("projectForPullRequestUrl", () => {
  const project = {
    id: "p",
    repositoryIdentity: { provider: "github", canonicalKey: "github.com/Acme/web" },
  } as never;
  it("finds the saved GitHub project a pull request belongs to", () => {
    expect(projectForPullRequestUrl([project], "https://github.com/acme/web/pull/12")).toEqual({
      project,
      canonicalUrl: "https://github.com/acme/web/pull/12",
    });
    expect(
      projectForPullRequestUrl([project], "https://github.com/acme/web/pull/12/files#r1"),
    ).toEqual({ project, canonicalUrl: "https://github.com/acme/web/pull/12" });
  });
  it("ignores other repositories and non pull request links", () => {
    expect(projectForPullRequestUrl([project], "https://github.com/acme/api/pull/12")).toBeNull();
    expect(projectForPullRequestUrl([project], "https://github.com/acme/web/issues/12")).toBeNull();
    expect(projectForPullRequestUrl([project], "not a url")).toBeNull();
  });
});
