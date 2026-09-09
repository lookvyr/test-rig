import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { GitHubCli } from "./GitHubCli.ts";
import { SourceControlProviderRegistry } from "./SourceControlProviderRegistry.ts";
import { SourceControlProvider } from "./SourceControlProvider.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { make } from "./GitHubPullRequestWorkspace.ts";

const summary = {
  number: 7,
  title: "PR",
  url: "https://github.com/owner/repo/pull/7",
  state: "OPEN",
  isDraft: false,
  author: { login: "alice" },
  baseRefName: "main",
  headRefName: "feature",
  headRefOid: "abc",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  labels: [],
};
const raw = {
  number: 7,
  title: "PR",
  html_url: summary.url,
  state: "open",
  merged: false,
  draft: false,
  user: { login: "alice" },
  body: "Body",
  base: { ref: "main", sha: "base-sha" },
  head: { ref: "feature", sha: "abc" },
  created_at: "2026-01-01",
  updated_at: "2026-01-02",
  additions: 1,
  deletions: 0,
  changed_files: 1,
  labels: [],
};
function fixture(
  options: {
    enabled?: boolean;
    github?: boolean;
    response?: (args: ReadonlyArray<string>) => string;
    truncated?: boolean;
  } = {},
) {
  const calls: ReadonlyArray<string>[] = [];
  let discoveries = 0;
  const workspace = make.pipe(
    Effect.provide([
      Layer.mock(GitHubCli)({
        execute: ({ args }) => {
          calls.push(args);
          return Effect.succeed({
            stdout: options.response?.(args) ?? JSON.stringify([summary]),
            stderr: "",
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdoutTruncated: options.truncated ?? false,
            stderrTruncated: false,
          });
        },
      }),
      Layer.mock(SourceControlProviderRegistry)({
        resolveHandle: () => {
          discoveries++;
          return Effect.succeed({
            enabled: true,
            provider: SourceControlProvider.of({
              kind: "github",
            } as SourceControlProvider["Service"]),
            context: {
              provider: {
                kind: options.github === false ? "gitlab" : "github",
                name: "GitHub",
                baseUrl: "https://github.com",
              },
              remoteName: "origin",
              remoteUrl: "git@github.com:owner/repo.git",
            },
          });
        },
      }),
      Layer.mock(ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlProviders: {
            ...DEFAULT_SERVER_SETTINGS.sourceControlProviders,
            github: options.enabled ?? true,
          },
        }),
      }),
    ]),
  );
  return { workspace, calls, discoveries: () => discoveries };
}
it.effect("disabled GitHub fails before discovery or gh execution for both methods", () =>
  Effect.gen(function* () {
    const f = fixture({ enabled: false });
    const service = yield* f.workspace;
    const listError = yield* Effect.flip(
      service.listPullRequests({ cwd: "/repo", state: "open", involvement: "all" }),
    );
    const detailError = yield* Effect.flip(
      service.getPullRequestDetails({ cwd: "/repo", reference: "7" }),
    );
    assert.include(listError.message, "disabled");
    assert.include(detailError.message, "disabled");
    assert.deepEqual(f.calls, []);
    assert.equal(f.discoveries(), 0);
  }),
);
it.effect("non-GitHub repositories and foreign PR URLs fail without gh", () =>
  Effect.gen(function* () {
    for (const [f, reference] of [
      [fixture({ github: false }), "7"],
      [fixture(), "https://github.com/other/repo/pull/7"],
    ] as const) {
      const service = yield* f.workspace;
      yield* Effect.flip(service.getPullRequestDetails({ cwd: "/repo", reference }));
      assert.deepEqual(f.calls, []);
    }
  }),
);
it.effect("forwards filters and detects a truncated list", () =>
  Effect.gen(function* () {
    for (const involvement of ["all", "authored", "review-requested"] as const) {
      const f = fixture({
        response: () => JSON.stringify(Array.from({ length: 101 }, () => summary)),
      });
      const service = yield* f.workspace;
      const result = yield* service.listPullRequests({
        cwd: "/repo",
        state: "merged",
        involvement,
      });
      assert.equal(result.repository, "https://github.com/owner/repo");
      assert.equal(result.pullRequests.length, 100);
      assert.isTrue(result.truncated);
      assert.include(f.calls[0]!, "merged");
      if (involvement === "authored") assert.include(f.calls[0]!, "--author");
      if (involvement === "review-requested") assert.include(f.calls[0]!, "review-requested:@me");
    }
  }),
);
it.effect("rejects malformed and byte-truncated responses with safe errors", () =>
  Effect.gen(function* () {
    for (const f of [
      fixture({ response: () => "private secret invalid json" }),
      fixture({ truncated: true }),
    ]) {
      const service = yield* f.workspace;
      const error = yield* Effect.flip(
        service.listPullRequests({ cwd: "/repo", state: "all", involvement: "all" }),
      );
      assert.notInclude(error.message, "private secret");
    }
  }),
);
it.effect("loads summary checks and files without requesting unused comments or reviews", () =>
  Effect.gen(function* () {
    const patch = "@@ -1 +1 @@\n-old\n+new";
    const f = fixture({
      response: (args) => {
        const endpoint = args.at(-1)!;
        if (endpoint.endsWith("pulls/7")) return JSON.stringify(raw);
        if (endpoint.includes("/files?"))
          return JSON.stringify([
            { filename: "a.ts", status: "modified", additions: 1, deletions: 1, patch },
          ]);
        if (endpoint.includes("/check-runs?"))
          return JSON.stringify({
            total_count: 1,
            check_runs: [
              { name: "test", status: "completed", conclusion: "success", html_url: null },
            ],
          });
        if (endpoint.includes("/status?")) return JSON.stringify({ total_count: 0, statuses: [] });
        throw new Error(`Unexpected GitHub request: ${endpoint}`);
      },
    });
    const service = yield* f.workspace;
    const result = yield* service.getPullRequestDetails({ cwd: "/repo", reference: "#7" });
    assert.equal(result.pullRequest.headSha, "abc");
    assert.equal(result.files[0]?.patch, patch);
    assert.deepEqual(result.timeline, []);
    assert.equal(result.checks[0]?.conclusion, "success");
    assert.isFalse(result.truncated);
    assert.equal(f.calls.length, 5);
    assert.isTrue(f.calls.every((args) => args[0] === "api"));
  }),
);

it.effect("reports incomplete files, check runs, and statuses", () =>
  Effect.gen(function* () {
    for (const incomplete of ["files", "checks", "statuses"] as const) {
      const f = fixture({
        response: (args) => {
          const endpoint = args.at(-1)!;
          if (endpoint.endsWith("pulls/7"))
            return JSON.stringify({ ...raw, changed_files: incomplete === "files" ? 1 : 0 });
          if (endpoint.includes("/check-runs?"))
            return JSON.stringify({ total_count: incomplete === "checks" ? 1 : 0, check_runs: [] });
          if (endpoint.includes("/status?"))
            return JSON.stringify({ total_count: incomplete === "statuses" ? 1 : 0, statuses: [] });
          return "[]";
        },
      });
      const service = yield* f.workspace;
      const result = yield* service.getPullRequestDetails({ cwd: "/repo", reference: "7" });
      assert.isTrue(result.truncated, incomplete);
    }
  }),
);

for (const revision of ["head", "base"] as const) {
  it.effect(`rejects a ${revision} change while the file patches are loading`, () =>
    Effect.gen(function* () {
      let reads = 0;
      const f = fixture({
        response: (args) => {
          const endpoint = args.at(-1)!;
          if (endpoint.endsWith("pulls/7"))
            return JSON.stringify({
              ...raw,
              [revision]: { ...raw[revision], sha: ++reads === 1 ? raw[revision].sha : "def" },
            });
          if (endpoint.includes("/check-runs?"))
            return JSON.stringify({ total_count: 0, check_runs: [] });
          if (endpoint.includes("/status?"))
            return JSON.stringify({ total_count: 0, statuses: [] });
          return "[]";
        },
      });
      const service = yield* f.workspace;
      const error = yield* Effect.flip(
        service.getPullRequestDetails({ cwd: "/repo", reference: "7" }),
      );
      assert.include(error.message, "changed while loading");
    }),
  );
}
