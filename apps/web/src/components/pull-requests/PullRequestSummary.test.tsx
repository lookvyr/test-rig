import type { GitGetPullRequestDetailsResult, GitPullRequestFile } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  buildPullRequestFileTree,
  PullRequestChecks,
  PullRequestFiles,
  pullRequestCheckState,
} from "./PullRequestSummary";

function file(path: string): GitPullRequestFile {
  return { path, previousPath: null, status: "modified", additions: 2, deletions: 1, patch: null };
}

describe("pull request Summary", () => {
  it("distinguishes active, unsuccessful, and non-passing completed checks", () => {
    const checks = [
      {
        name: "Tests",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/owner/repo/actions/runs/1",
      },
      { name: "Lint", status: "completed", conclusion: "failure", url: null },
      { name: "Build", status: "in_progress", conclusion: null, url: null },
      { name: "Deploy", status: "queued", conclusion: null, url: null },
      { name: "Skipped job", status: "completed", conclusion: "skipped", url: null },
      { name: "Neutral job", status: "completed", conclusion: "neutral", url: null },
      { name: "Cancelled job", status: "completed", conclusion: "cancelled", url: null },
      { name: "Missing conclusion", status: "completed", conclusion: null, url: null },
    ];
    const html = renderToStaticMarkup(<PullRequestChecks checks={checks} />);
    for (const state of [
      "passed",
      "failed",
      "running",
      "pending",
      "skipped",
      "neutral",
      "cancelled",
      "unknown",
    ]) {
      expect(html).toContain(`1 ${state}`);
    }
    expect(html).toContain("<details class=");
    expect(html).not.toContain("<details open=");
    expect(html).toContain('href="https://github.com/owner/repo/actions/runs/1"');
    expect(html).toContain("Missing conclusion");
    expect(html).toContain("failure");
  });

  it("classifies legacy commit statuses and failed check-run outcomes", () => {
    for (const conclusion of [
      "FAILURE",
      "ERROR",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STARTUP_FAILURE",
    ]) {
      expect(
        pullRequestCheckState({ name: "CI", status: "completed", conclusion, url: null }),
      ).toBe("failed");
    }
    expect(
      pullRequestCheckState({ name: "CI", status: "pending", conclusion: null, url: null }),
    ).toBe("pending");
    expect(
      pullRequestCheckState({
        name: "CI",
        status: "completed",
        conclusion: "future_status",
        url: null,
      }),
    ).toBe("unknown");
  });

  it("groups files by their full directory path and keeps file names intact", () => {
    const tree = buildPullRequestFileTree([
      file("README.md"),
      file("src/web/view.tsx"),
      file("src/server/view.tsx"),
      file("src/web/index.ts"),
      file("__proto__/constructor.ts"),
    ]);
    expect(tree.map((node) => node.name)).toEqual(["__proto__", "src", "README.md"]);
    const source = tree.find((node) => node.path === "src");
    expect(source?.kind).toBe("directory");
    if (source?.kind !== "directory") return;
    expect(source.children.map((node) => node.path)).toEqual(["src/server", "src/web"]);
    const web = source.children[1];
    if (web?.kind !== "directory") throw new Error("Expected web directory");
    expect(web.children.map((node) => node.path)).toEqual(["src/web/index.ts", "src/web/view.tsx"]);
  });

  it("compresses single-directory chains and counts every descendant file", () => {
    const tree = buildPullRequestFileTree([
      file("apps/web/src/a.ts"),
      file("apps/web/src/deep/b.ts"),
    ]);
    expect(tree).toMatchObject([
      {
        kind: "directory",
        name: "apps/web/src",
        path: "apps/web/src",
        fileCount: 2,
        children: [
          { kind: "directory", name: "deep", fileCount: 1 },
          { kind: "file", name: "a.ts" },
        ],
      },
    ]);
  });

  it("uses PR totals when the returned file list is incomplete and exposes a display-only tree", () => {
    const details: GitGetPullRequestDetailsResult = {
      repository: "owner/repo",
      body: "",
      checks: [],
      timeline: [],
      truncated: true,
      pullRequest: {
        number: 1,
        title: "Change",
        url: "https://github.com/owner/repo/pull/1",
        state: "open",
        isDraft: false,
        author: "me",
        baseRefName: "main",
        headRefName: "feature",
        headSha: "abc",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        additions: 42,
        deletions: 12,
        changedFiles: 10,
        labels: [],
      },
      files: [file("src/web/view.tsx")],
    };
    const html = renderToStaticMarkup(<PullRequestFiles details={details} />);
    expect(html).toContain("Showing 1 of 10 files");
    expect(html).toContain("+42");
    expect(html).toContain("−12");
    expect(html).toContain("<summary");
    expect(html).toContain("view.tsx");
    expect(html).not.toContain("<button");
  });
});
