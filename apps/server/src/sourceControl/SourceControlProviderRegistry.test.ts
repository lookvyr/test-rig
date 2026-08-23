import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings as ServerSettingsContract,
  type SourceControlProviderSettings,
  VcsRepositoryDetectionError,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import * as BitbucketApi from "./BitbucketApi.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");
const ALL_SOURCE_CONTROL_PROVIDERS_ENABLED = {
  github: true,
  gitlab: true,
  "azure-devops": true,
  bitbucket: true,
} as const;

const processOutput = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeRegistry(input: {
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>;
  readonly process?: Partial<VcsProcess.VcsProcess["Service"]>;
  readonly resolve?: VcsDriverRegistry.VcsDriverRegistry["Service"]["resolve"];
  readonly sourceControlProviders?: Partial<SourceControlProviderSettings>;
  readonly getSettings?: Effect.Effect<ServerSettingsContract>;
}) {
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: input.remotes.map((remote) => ({
          ...remote,
          pushUrl: Option.none(),
          isPrimary: remote.name === "origin",
        })),
        freshness: {
          source: "live-local" as const,
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const registryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
    get: () => Effect.succeed(driver as unknown as VcsDriver.VcsDriver["Service"]),
    resolve:
      input.resolve ??
      (() =>
        Effect.succeed({
          kind: "git",
          repository: {
            kind: "git",
            rootPath: "/repo",
            metadataPath: null,
            freshness: {
              source: "live-local" as const,
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          },
          driver: driver as unknown as VcsDriver.VcsDriver["Service"],
        })),
  });

  const processLayer = Layer.mock(VcsProcess.VcsProcess)({
    run: () => Effect.succeed(processOutput("")),
    ...input.process,
  });

  return SourceControlProviderRegistry.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        registryLayer,
        processLayer,
        Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
        Layer.mock(BitbucketApi.BitbucketApi)({}),
        Layer.mock(GitHubCli.GitHubCli)({}),
        Layer.mock(GitLabCli.GitLabCli)({}),
        input.getSettings === undefined
          ? ServerSettings.ServerSettingsService.layerTest({
              sourceControlProviders:
                input.sourceControlProviders ?? ALL_SOURCE_CONTROL_PROVIDERS_ENABLED,
            })
          : Layer.mock(ServerSettings.ServerSettingsService)({
              getSettings: input.getSettings,
            }),
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-source-control-registry-test-",
        }).pipe(Layer.provide(NodeServices.layer)),
      ),
    ),
  );
}

it.effect("routes GitHub remotes to the GitHub provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:pingdotgg/t3code.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("routes directly by provider kind for remote-first workflows", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [],
    });

    const provider = yield* registry.get("github");

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("includes the request cwd when an unregistered provider is used", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({ remotes: [] });
    const provider = yield* registry.get("unknown");

    const error = yield* provider
      .getChangeRequest({ cwd: "/repo", reference: "#42" })
      .pipe(Effect.flip);

    assert.strictEqual(error.provider, "unknown");
    assert.strictEqual(error.operation, "getChangeRequest");
    assert.strictEqual(error.cwd, "/repo");
    assert.strictEqual(error.reference, "#42");
  }),
);

it.effect("fails provider operations closed when the provider is disabled", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@bitbucket.org:acme/repo.git" }],
      sourceControlProviders: { bitbucket: false },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });
    const error = yield* provider
      .listChangeRequests({ cwd: "/repo", headSelector: "feature", state: "all" })
      .pipe(Effect.flip);

    assert.strictEqual(provider.kind, "bitbucket");
    assert.strictEqual(error.provider, "bitbucket");
    assert.strictEqual(error.operation, "listChangeRequests");
    assert.strictEqual(error.detail, "The bitbucket source control provider is disabled.");
  }),
);

it.effect("rechecks enablement when an acquired provider operation runs", () =>
  Effect.gen(function* () {
    const bitbucketEnabled = yield* Ref.make(true);
    const registry = yield* makeRegistry({
      remotes: [],
      getSettings: Ref.get(bitbucketEnabled).pipe(
        Effect.map((enabled) => ({
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlProviders: {
            ...DEFAULT_SERVER_SETTINGS.sourceControlProviders,
            bitbucket: enabled,
          },
        })),
      ),
    });
    const provider = yield* registry.get("bitbucket");

    yield* Ref.set(bitbucketEnabled, false);
    const error = yield* provider
      .listChangeRequests({ cwd: "/repo", headSelector: "feature", state: "all" })
      .pipe(Effect.flip);

    assert.strictEqual(error.detail, "The bitbucket source control provider is disabled.");
  }),
);

it.effect("retains VCS detection failures with structured cwd context", () =>
  Effect.gen(function* () {
    const cause = new VcsRepositoryDetectionError({
      operation: "resolve",
      cwd: "/repo",
      detail: "raw VCS detection failure",
      cause: new Error("raw nested failure"),
    });
    const registry = yield* makeRegistry({
      remotes: [],
      resolve: () => Effect.fail(cause),
    });

    const error = yield* registry.resolve({ cwd: "/repo" }).pipe(Effect.flip);

    assert.strictEqual(error.provider, "unknown");
    assert.strictEqual(error.operation, "detectProvider");
    assert.strictEqual(error.cwd, "/repo");
    assert.strictEqual(error.detail, "Failed to detect source control provider.");
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes(cause.message), false);
  }),
);

it.effect("routes GitLab remotes to the GitLab provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@gitlab.com:group/project.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes authenticated self-hosted GitLab remotes without relying on host naming", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test/group/project.git" }],
      process: {
        run: () =>
          Effect.succeed(
            processOutput(
              `gitlab.com
  x gitlab.com: API call failed: 401 Unauthorized
  ! No token found
self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
  ✓ Token found: ******
`,
              { exitCode: ChildProcessSpawner.ExitCode(1) },
            ),
          ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes authenticated self-hosted GitLab remotes on non-standard ports", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://self-hosted.example.test:8443/group/project.git" }],
      process: {
        run: () =>
          Effect.succeed(
            processOutput(
              `self-hosted.example.test:8443
  ✓ Logged in to self-hosted.example.test:8443 as gitlab-user
  ✓ Token found: ******
`,
            ),
          ),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes Bitbucket remotes to the Bitbucket provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@bitbucket.org:pingdotgg/t3code.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "bitbucket");
  }),
);

it.effect("routes Azure DevOps remotes to the Azure DevOps provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);

it.effect("falls back to a non-origin remote when origin is not configured", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "upstream", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);
