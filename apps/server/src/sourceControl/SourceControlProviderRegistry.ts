import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import {
  SourceControlProviderError,
  type SourceControlProviderDiscoveryItem,
  type ServerSettings,
} from "@t3tools/contracts";
import type { SourceControlProviderKind } from "@t3tools/contracts";
import { detectSourceControlProviderFromRemoteUrl } from "@t3tools/shared/sourceControl";

import * as AzureDevOpsSourceControlProvider from "./AzureDevOpsSourceControlProvider.ts";
import * as BitbucketSourceControlProvider from "./BitbucketSourceControlProvider.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";
import * as GitLabSourceControlProvider from "./GitLabSourceControlProvider.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  probeSourceControlProvider,
  refineUnknownRemoteProvider,
  type SourceControlProviderDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";
import { ServerConfig } from "../config.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const PROVIDER_DETECTION_CACHE_CAPACITY = 2_048;
const PROVIDER_DETECTION_CACHE_TTL = Duration.seconds(5);

export interface SourceControlProviderRegistration {
  readonly kind: SourceControlProviderKind;
  readonly provider: SourceControlProvider.SourceControlProvider["Service"];
  readonly discovery: SourceControlProviderDiscoverySpec;
}

export interface SourceControlProviderHandle {
  readonly provider: SourceControlProvider.SourceControlProvider["Service"];
  readonly context: SourceControlProvider.SourceControlProviderContext | null;
  readonly enabled: boolean;
}

export class SourceControlProviderRegistry extends Context.Service<
  SourceControlProviderRegistry,
  {
    readonly get: (
      kind: SourceControlProviderKind,
    ) => Effect.Effect<
      SourceControlProvider.SourceControlProvider["Service"],
      SourceControlProviderError
    >;
    readonly resolveHandle: (input: {
      readonly cwd: string;
    }) => Effect.Effect<SourceControlProviderHandle, SourceControlProviderError>;
    readonly resolve: (input: {
      readonly cwd: string;
    }) => Effect.Effect<
      SourceControlProvider.SourceControlProvider["Service"],
      SourceControlProviderError
    >;
    readonly discover: Effect.Effect<ReadonlyArray<SourceControlProviderDiscoveryItem>>;
  }
>()("t3/sourceControl/SourceControlProviderRegistry") {}

function unsupportedProvider(
  kind: SourceControlProviderKind,
  detail = `No ${kind} source control provider is registered.`,
): SourceControlProvider.SourceControlProvider["Service"] {
  return SourceControlProvider.SourceControlProvider.of({
    kind,
    listChangeRequests: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "listChangeRequests",
        cwd: input.cwd,
        detail,
      }),
    getChangeRequest: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "getChangeRequest",
        cwd: input.cwd,
        reference: SourceControlProvider.transportSafeSourceControlErrorValue(input.reference),
        detail,
      }),
    createChangeRequest: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "createChangeRequest",
        cwd: input.cwd,
        reference: SourceControlProvider.transportSafeSourceControlErrorValue(input.headSelector),
        detail,
      }),
    getRepositoryCloneUrls: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "getRepositoryCloneUrls",
        cwd: input.cwd,
        repository: SourceControlProvider.transportSafeSourceControlErrorValue(input.repository),
        detail,
      }),
    createRepository: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "createRepository",
        cwd: input.cwd,
        repository: SourceControlProvider.transportSafeSourceControlErrorValue(input.repository),
        detail,
      }),
    getDefaultBranch: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "getDefaultBranch",
        cwd: input.cwd,
        detail,
      }),
    checkoutChangeRequest: (input) =>
      new SourceControlProviderError({
        provider: kind,
        operation: "checkoutChangeRequest",
        cwd: input.cwd,
        reference: SourceControlProvider.transportSafeSourceControlErrorValue(input.reference),
        detail,
      }),
  });
}

function isProviderEnabled(settings: ServerSettings, kind: SourceControlProviderKind): boolean {
  return kind !== "unknown" && settings.sourceControlProviders[kind];
}

function disabledProvider(
  kind: SourceControlProviderKind,
): SourceControlProvider.SourceControlProvider["Service"] {
  return unsupportedProvider(kind, `The ${kind} source control provider is disabled.`);
}

function gateProvider(
  provider: SourceControlProvider.SourceControlProvider["Service"],
  getSettings: Effect.Effect<ServerSettings>,
): SourceControlProvider.SourceControlProvider["Service"] {
  const disabled = disabledProvider(provider.kind);
  const isEnabled = getSettings.pipe(
    Effect.map((settings) => isProviderEnabled(settings, provider.kind)),
  );

  return SourceControlProvider.SourceControlProvider.of({
    kind: provider.kind,
    listChangeRequests: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.listChangeRequests(input) : disabled.listChangeRequests(input),
        ),
      ),
    getChangeRequest: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.getChangeRequest(input) : disabled.getChangeRequest(input),
        ),
      ),
    createChangeRequest: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.createChangeRequest(input) : disabled.createChangeRequest(input),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.getRepositoryCloneUrls(input) : disabled.getRepositoryCloneUrls(input),
        ),
      ),
    createRepository: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.createRepository(input) : disabled.createRepository(input),
        ),
      ),
    getDefaultBranch: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.getDefaultBranch(input) : disabled.getDefaultBranch(input),
        ),
      ),
    checkoutChangeRequest: (input) =>
      isEnabled.pipe(
        Effect.flatMap((enabled) =>
          enabled ? provider.checkoutChangeRequest(input) : disabled.checkoutChangeRequest(input),
        ),
      ),
  });
}

function selectProviderContext(
  remotes: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>,
): SourceControlProvider.SourceControlProviderContext | null {
  const candidates: Array<SourceControlProvider.SourceControlProviderContext> = [];
  for (const remote of remotes) {
    const provider = detectSourceControlProviderFromRemoteUrl(remote.url);
    if (provider) {
      candidates.push({
        provider,
        remoteName: remote.name,
        remoteUrl: remote.url,
      });
    }
  }

  return (
    candidates.find((candidate) => candidate.remoteName === "origin") ??
    candidates.find((candidate) => candidate.provider.kind !== "unknown") ??
    candidates[0] ??
    null
  );
}

function bindProviderContext(
  provider: SourceControlProvider.SourceControlProvider["Service"],
  context: SourceControlProvider.SourceControlProviderContext | null,
): SourceControlProvider.SourceControlProvider["Service"] {
  if (context === null) {
    return provider;
  }

  return SourceControlProvider.SourceControlProvider.of({
    kind: provider.kind,
    listChangeRequests: (input) =>
      provider.listChangeRequests({
        ...input,
        context: input.context ?? context,
      }),
    getChangeRequest: (input) =>
      provider.getChangeRequest({
        ...input,
        context: input.context ?? context,
      }),
    createChangeRequest: (input) =>
      provider.createChangeRequest({
        ...input,
        context: input.context ?? context,
      }),
    getRepositoryCloneUrls: (input) =>
      provider.getRepositoryCloneUrls({
        ...input,
        context: input.context ?? context,
      }),
    createRepository: (input) => provider.createRepository(input),
    getDefaultBranch: (input) =>
      provider.getDefaultBranch({
        ...input,
        context: input.context ?? context,
      }),
    checkoutChangeRequest: (input) =>
      provider.checkoutChangeRequest({
        ...input,
        context: input.context ?? context,
      }),
  });
}

export const makeWithProviders = Effect.fn("makeSourceControlProviderRegistryWithProviders")(
  function* (registrations: ReadonlyArray<SourceControlProviderRegistration>) {
    const config = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService.ServerSettingsService;
    const getSettings = serverSettings.getSettings.pipe(Effect.orDie);
    const process = yield* VcsProcess.VcsProcess;
    const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
    const providers = new Map<
      SourceControlProviderKind,
      SourceControlProvider.SourceControlProvider["Service"]
    >(registrations.map((registration) => [registration.kind, registration.provider]));
    const discoverySpecs = registrations.map((registration) => registration.discovery);

    const get: SourceControlProviderRegistry["Service"]["get"] = (kind) => {
      const provider = providers.get(kind);
      return Effect.succeed(
        provider ? gateProvider(provider, getSettings) : unsupportedProvider(kind),
      );
    };

    const detectProviderContext = Effect.fn("SourceControlProviderRegistry.detectProviderContext")(
      function* (cwd: string) {
        const handle = yield* vcsRegistry.resolve({ cwd }).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "unknown",
                operation: "detectProvider",
                cwd,
                detail: "Failed to detect source control provider.",
                cause: error,
              }),
          ),
        );
        const remotes = yield* handle.driver.listRemotes(cwd).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "unknown",
                operation: "detectProvider",
                cwd,
                detail: "Failed to detect source control provider.",
                cause: error,
              }),
          ),
        );
        const context = selectProviderContext(remotes.remotes);

        const settings = yield* getSettings;
        return yield* refineUnknownRemoteProvider({
          specs: discoverySpecs.filter((spec) => isProviderEnabled(settings, spec.kind)),
          process,
          cwd,
          context,
        });
      },
    );

    const providerContextCache = yield* Cache.makeWith<
      string,
      SourceControlProvider.SourceControlProviderContext | null,
      SourceControlProviderError
    >(detectProviderContext, {
      capacity: PROVIDER_DETECTION_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? PROVIDER_DETECTION_CACHE_TTL : Duration.zero),
    });

    const resolveHandle: SourceControlProviderRegistry["Service"]["resolveHandle"] = (input) =>
      Cache.get(providerContextCache, input.cwd).pipe(
        Effect.zip(getSettings),
        Effect.map(([context, settings]) => {
          const kind = context?.provider.kind ?? "unknown";
          const registered = providers.get(kind);
          const provider = registered
            ? gateProvider(bindProviderContext(registered, context), getSettings)
            : unsupportedProvider(kind);
          return {
            provider,
            context,
            enabled: isProviderEnabled(settings, kind),
          } satisfies SourceControlProviderHandle;
        }),
      );

    return SourceControlProviderRegistry.of({
      get,
      resolveHandle,
      resolve: (input) => resolveHandle(input).pipe(Effect.map((handle) => handle.provider)),
      discover: getSettings.pipe(
        Effect.flatMap((settings) =>
          Effect.all(
            discoverySpecs
              .filter((spec) => isProviderEnabled(settings, spec.kind))
              .map((spec) =>
                probeSourceControlProvider({
                  spec,
                  process,
                  cwd: config.cwd,
                }),
              ),
            { concurrency: "unbounded" },
          ),
        ),
      ),
    });
  },
);

export const make = Effect.gen(function* () {
  const github = yield* GitHubSourceControlProvider.make;
  const gitlab = yield* GitLabSourceControlProvider.make;
  const bitbucket = yield* BitbucketSourceControlProvider.make;
  const bitbucketDiscovery = yield* BitbucketSourceControlProvider.makeDiscovery;
  const azureDevOps = yield* AzureDevOpsSourceControlProvider.make;
  return yield* makeWithProviders([
    {
      kind: "github",
      provider: github,
      discovery: GitHubSourceControlProvider.discovery,
    },
    {
      kind: "gitlab",
      provider: gitlab,
      discovery: GitLabSourceControlProvider.discovery,
    },
    {
      kind: "azure-devops",
      provider: azureDevOps,
      discovery: AzureDevOpsSourceControlProvider.discovery,
    },
    {
      kind: "bitbucket",
      provider: bitbucket,
      discovery: bitbucketDiscovery,
    },
  ]);
});

export const layer = Layer.effect(SourceControlProviderRegistry, make);
