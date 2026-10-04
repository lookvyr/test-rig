import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

import { ServerSettingsService } from "../serverSettings.ts";
import * as GitHubPullRequestCli from "./GitHubPullRequestCli.ts";
import * as GitHubPullRequestProvider from "./GitHubPullRequestProvider.ts";
import { fromProviders, gateProvider } from "./PullRequestProviderRegistry.ts";

it.effect(
  "retained provider handles recheck hosting settings before reads, mutations and credentials",
  () =>
    Effect.gen(function* () {
      const enabled = yield* Ref.make(true);
      const settings = yield* ServerSettingsService.pipe(
        Effect.provide(
          Layer.mock(ServerSettingsService)({
            getSettings: Ref.get(enabled).pipe(
              Effect.map((github) => ({
                ...DEFAULT_SERVER_SETTINGS,
                sourceControlProviders: {
                  ...DEFAULT_SERVER_SETTINGS.sourceControlProviders,
                  github,
                },
              })),
            ),
          }),
        ),
      );
      const base = yield* GitHubPullRequestProvider.make.pipe(
        Effect.provide(Layer.mock(GitHubPullRequestCli.GitHubPullRequestCli)({})),
      );
      const calls: string[] = [];
      const provider = fromProviders([
        gateProvider(
          {
            ...base,
            getViewer: () => {
              calls.push("read");
              return Effect.succeed("viewer");
            },
            runAction: () => {
              calls.push("mutation");
              return Effect.void;
            },
            withVerifiedCredential: (_, use) => {
              calls.push("credential");
              return use({ accountId: "account", viewer: "viewer", credentialFingerprint: "test" });
            },
          },
          settings,
        ),
      ]).get("github");
      if (!provider?.withVerifiedCredential) return yield* Effect.die("Missing provider");
      const input = { cwd: "/repo", host: "github.com" };
      const operations = [
        provider.getViewer(input).pipe(Effect.asVoid),
        provider.runAction({ ...input, repository: "acme/repo", number: 1, action: "close" }),
        provider.withVerifiedCredential(input, () => {
          calls.push("use credential");
          return Effect.void;
        }),
      ];

      for (const operation of operations) yield* operation;
      assert.deepEqual(calls, ["read", "mutation", "credential", "use credential"]);
      calls.length = 0;
      yield* Ref.set(enabled, false);
      for (const operation of operations) {
        const error = yield* operation.pipe(Effect.flip);
        assert.strictEqual(error._tag, "PullRequestProviderError");
        assert.include(error.detail, "integration is disabled");
      }
      assert.deepEqual(calls, []);

      yield* Ref.set(enabled, true);
      for (const operation of operations) yield* operation;
      assert.deepEqual(calls, ["read", "mutation", "credential", "use credential"]);
    }),
);
