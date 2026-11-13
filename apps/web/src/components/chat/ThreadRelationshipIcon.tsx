import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { BotIcon, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export function threadRelationshipStatusLabel(status: string | null): string {
  switch (status) {
    case "preparing":
    case "starting":
      return "Starting";
    case "running":
    case "in_progress":
      return "Running";
    case "pending":
    case "queued":
      return "Queued";
    case "waiting":
    case "blocked":
      return "Waiting";
    case "completed":
      return "Done";
    case "failed":
    case "error":
      return "Failed";
    case "cancelled":
    case "interrupted":
      return "Stopped";
    case "rolled_back":
      return "Reverted";
    case "resolved_native":
      return "Resolved (native)";
    case "resolved_portable":
      return "Resolved (portable)";
    case "consumed":
      return "Consumed";
    case "superseded":
      return "Superseded";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}

const NO_PROVIDER_ENTRIES: ReadonlyArray<ProviderInstanceEntry> = [];

/** Shared by lineage and timeline links, including the provider glyph and status badge. */
export function ThreadRelationshipIcon({
  driver,
  provider,
  providerEntries = NO_PROVIDER_ENTRIES,
  status,
  fallbackIcon: FallbackIcon = BotIcon,
}: {
  driver?: ProviderDriverKind | undefined;
  provider?: ServerProvider | undefined;
  /** Lets the glyph name its account when more than one shares a provider. */
  providerEntries?: ReadonlyArray<ProviderInstanceEntry>;
  status: string | null;
  fallbackIcon?: LucideIcon;
}) {
  const iconClassName = "size-4 shrink-0 text-muted-foreground";
  const entry = driver
    ? providerEntries.find((candidate) => candidate.instanceId === provider?.instanceId)
    : undefined;
  const showInstanceBadge = entry !== undefined && shouldShowInstanceBadge(entry, providerEntries);
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      {driver ? (
        <ProviderInstanceIcon
          driverKind={driver}
          displayName={entry?.displayName ?? provider?.displayName ?? driver}
          accentColor={entry?.accentColor}
          showBadge={showInstanceBadge}
          badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
          iconClassName={iconClassName}
          className="z-auto"
        />
      ) : (
        <FallbackIcon className={iconClassName} />
      )}
      <span
        className={cn(
          "absolute size-2 rounded-full border-2 border-card",
          showInstanceBadge ? "-left-1 -top-1" : "-bottom-1 -right-1",
          status === "running" ||
            status === "in_progress" ||
            status === "pending" ||
            status === "waiting"
            ? "bg-info"
            : status === "failed" || status === "error"
              ? "bg-destructive"
              : status === "completed"
                ? "bg-success"
                : "bg-muted-foreground/45",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
