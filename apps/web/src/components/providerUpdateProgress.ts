import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@t3tools/contracts";

export type ProviderUpdateSidebarPillTone = "loading" | "warning" | "error" | "success";

export interface ProviderUpdateSidebarPillView {
  readonly key: string;
  readonly tone: ProviderUpdateSidebarPillTone;
  readonly title: string;
  readonly description: string;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

interface ProviderUpdateSidebarPillOptions {
  readonly visibleAfterIso?: string;
  readonly dismissedKeys?: ReadonlySet<string>;
}

const PROVIDER_UPDATE_SUCCESS_VISIBLE_MS = 3_000;

const providerName = (provider: ServerProvider) =>
  PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;

const providerList = (providers: ReadonlyArray<ServerProvider>) =>
  providers.map(providerName).join(providers.length === 2 ? " and " : ", ");

const updateStateKey = (provider: ServerProvider) =>
  [
    provider.instanceId,
    provider.updateState?.status ?? "idle",
    provider.updateState?.finishedAt ?? "pending",
    provider.updateState?.message ?? "",
  ].join(":");

export function isProviderUpdateActive(provider: Pick<ServerProvider, "updateState">): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

function isRecentTerminalProvider(
  provider: ServerProvider,
  visibleAfterIso: string | undefined,
): boolean {
  const status = provider.updateState?.status;
  if (status !== "failed" && status !== "unchanged" && status !== "succeeded") {
    return false;
  }
  if (visibleAfterIso === undefined) {
    return true;
  }
  const finishedAt = provider.updateState?.finishedAt;
  return finishedAt !== null && finishedAt !== undefined && finishedAt >= visibleAfterIso;
}

function latestFinishedAt(providers: ReadonlyArray<ServerProvider>): string {
  return providers.reduce(
    (latest, provider) =>
      provider.updateState?.finishedAt && provider.updateState.finishedAt > latest
        ? provider.updateState.finishedAt
        : latest,
    "",
  );
}

export function getProviderUpdateSidebarPillView(
  providers: ReadonlyArray<ServerProvider>,
  options?: ProviderUpdateSidebarPillOptions,
): ProviderUpdateSidebarPillView | null {
  const activeProviders = providers.filter(isProviderUpdateActive);
  if (activeProviders.length > 0) {
    return {
      key: `loading:${activeProviders.map(updateStateKey).toSorted().join("|")}`,
      tone: "loading",
      title:
        activeProviders.length === 1
          ? `Updating ${providerName(activeProviders[0]!)}`
          : `Updating ${activeProviders.length} providers`,
      description: `${providerList(activeProviders)} update${activeProviders.length === 1 ? " is" : "s are"} in progress.`,
    };
  }

  const terminalProviders = providers.filter((provider) =>
    isRecentTerminalProvider(provider, options?.visibleAfterIso),
  );
  const candidates: Array<{
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly view: ProviderUpdateSidebarPillView;
  }> = [];

  const failed = terminalProviders.filter((provider) => provider.updateState?.status === "failed");
  if (failed.length > 0) {
    candidates.push({
      providers: failed,
      view: {
        key: `failed:${failed.map(updateStateKey).toSorted().join("|")}`,
        tone: "error",
        title:
          failed.length === 1
            ? `${providerName(failed[0]!)} update failed`
            : `${failed.length} provider updates failed`,
        description:
          failed.length === 1 && failed[0]!.updateState?.message
            ? failed[0]!.updateState!.message!
            : `${providerList(failed)} failed to update. Check provider settings for details.`,
        dismissible: true,
      },
    });
  }

  const unchanged = terminalProviders.filter(
    (provider) => provider.updateState?.status === "unchanged",
  );
  if (unchanged.length > 0) {
    candidates.push({
      providers: unchanged,
      view: {
        key: `unchanged:${unchanged.map(updateStateKey).toSorted().join("|")}`,
        tone: "warning",
        title:
          unchanged.length === 1
            ? `Could not confirm ${providerName(unchanged[0]!)}`
            : `Could not confirm ${unchanged.length} providers`,
        description:
          unchanged.length === 1 && unchanged[0]!.updateState?.message
            ? unchanged[0]!.updateState!.message!
            : "The update command completed, but the provider could not be confirmed locally.",
        dismissible: true,
      },
    });
  }

  const succeeded = terminalProviders.filter(
    (provider) => provider.updateState?.status === "succeeded",
  );
  if (succeeded.length > 0) {
    candidates.push({
      providers: succeeded,
      view: {
        key: `succeeded:${succeeded.map(updateStateKey).toSorted().join("|")}`,
        tone: "success",
        title:
          succeeded.length === 1
            ? `${providerName(succeeded[0]!)} update complete`
            : `${succeeded.length} provider updates complete`,
        description:
          succeeded.length === 1
            ? "New sessions will use the refreshed provider."
            : "New sessions will use the refreshed providers.",
        dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
      },
    });
  }

  return (
    candidates
      .toSorted((left, right) =>
        latestFinishedAt(right.providers).localeCompare(latestFinishedAt(left.providers)),
      )
      .map(({ view }) => view)
      .find((view) => !options?.dismissedKeys?.has(view.key)) ?? null
  );
}
