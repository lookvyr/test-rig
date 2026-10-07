import type {
  OrchestrationV2ThreadShell,
  OrchestrationProjectShell,
  ServerProvider,
  ProviderDriverKind,
  ProviderInstanceId,
  OrchestrationV2Subagent,
} from "@t3tools/contracts";
import { fileBasename } from "@t3tools/client-runtime/markdown-links";
import {
  formatModelSlugName,
  getModelSelectionStringOptionValue,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { getTriggerDisplayModelName } from "./providerIconUtils";
import type { ReactNode } from "react";
import {
  BotIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  FolderIcon,
  GitBranchIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";
import { ThreadHoverCard } from "../ThreadHoverCard";
import { MiddleTruncate } from "../ui/middle-truncate";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "../../providerInstances";
import { cn } from "~/lib/utils";

/** Geometry and preview limits stay identical in lineage and timeline tooltips. */
export function SubagentTooltipContent(props: {
  title: string;
  model: string | null;
  providerInstanceId: ProviderInstanceId;
  origin: OrchestrationV2Subagent["origin"];
  provider?: ServerProvider | undefined;
  providers?: ReadonlyArray<ServerProvider> | undefined;
  driver?: ProviderDriverKind | undefined;
  elapsed?: ReactNode;
  parentThread?: Pick<OrchestrationV2ThreadShell, "projectId" | "worktreePath"> | undefined;
  childThread?:
    | Pick<OrchestrationV2ThreadShell, "branch" | "worktreePath" | "modelSelection">
    | undefined;
  parentProject?: Pick<OrchestrationProjectShell, "workspaceRoot"> | undefined;
  childProject?: Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot"> | undefined;
  status: string;
  result?: string | null | undefined;
  progress?: string | null | undefined;
}) {
  const model = props.model?.trim();
  const modelSlug = props.provider
    ? resolveSelectableModel(props.provider.driver, model, props.provider.models)
    : model;
  const providerModel = props.provider?.models.find((candidate) => candidate.slug === modelSlug);
  const modelLabel = providerModel
    ? getTriggerDisplayModelName(providerModel)
    : model
      ? formatModelSlugName(model)
      : "Not reported";
  const childSelection = props.childThread?.modelSelection;
  const childModel = props.provider
    ? resolveSelectableModel(props.provider.driver, childSelection?.model, props.provider.models)
    : childSelection?.model.trim();
  // Native children do not inherit the parent's saved traits. App-owned child
  // settings describe this model only when both account and model match.
  const matchingSelection =
    props.origin === "app_owned" &&
    childModel === (modelSlug ?? model) &&
    childSelection?.instanceId === props.providerInstanceId
      ? childSelection
      : undefined;
  const effort = ["reasoningEffort", "effort", "reasoning", "variant"]
    .map((id) => getModelSelectionStringOptionValue(matchingSelection, id))
    .find(Boolean);
  const speedLabel = providerModel?.capabilities?.optionDescriptors
    ?.map((descriptor) => {
      const saved = matchingSelection?.options?.find((option) => option.id === descriptor.id);
      if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
        return saved?.value === true ? "Fast" : null;
      }
      if (
        props.provider?.driver === "codex" &&
        descriptor.id === "serviceTier" &&
        descriptor.type === "select"
      ) {
        const option = descriptor.options.find((option) => option.id === saved?.value);
        return option?.label === "Fast" || option?.label === "Ultrafast" ? option.label : null;
      }
      return null;
    })
    .find(Boolean);
  const currentWorkspace = props.parentThread?.worktreePath ?? props.parentProject?.workspaceRoot;
  const childWorkspace = props.childThread?.worktreePath ?? props.childProject?.workspaceRoot;
  const metadata = [
    ...(props.parentThread &&
    props.childProject &&
    props.childProject.id !== props.parentThread.projectId
      ? [{ label: "Project", value: props.childProject.title }]
      : []),
    ...(currentWorkspace && childWorkspace && currentWorkspace !== childWorkspace
      ? [
          {
            label: props.childThread?.branch
              ? "Branch"
              : props.childThread?.worktreePath
                ? "Worktree"
                : "Workspace",
            value: props.childThread?.branch ?? fileBasename(childWorkspace),
          },
        ]
      : []),
  ];
  const settled = ["completed", "failed", "cancelled", "interrupted"].includes(props.status);
  const result = props.result?.trim();
  const progress = props.progress?.trim();
  const detail = (settled ? result || progress : progress || result) || "";
  const compactDetail = detail.trim().replace(/\s+/g, " ");
  const preview =
    compactDetail.length > 280 ? `${compactDetail.slice(0, 280).trimEnd()}…` : compactDetail;
  const driver = props.provider?.driver ?? props.driver;
  const entries = deriveProviderInstanceEntries(props.providers ?? []);
  const entry = entries.find((candidate) => candidate.instanceId === props.provider?.instanceId);
  const showInstanceBadge = entry !== undefined && shouldShowInstanceBadge(entry, entries);
  const working = ["running", "in_progress", "pending", "waiting"].includes(props.status);
  const failed = ["failed", "error"].includes(props.status);
  const StatusIcon = working
    ? CircleDashedIcon
    : failed
      ? CircleXIcon
      : props.status === "completed"
        ? CheckIcon
        : CircleDashedIcon;
  return (
    <ThreadHoverCard title={props.title}>
      <div className="flex min-w-0 items-center gap-2">
        {driver ? (
          <ProviderInstanceIcon
            driverKind={driver}
            displayName={entry?.displayName ?? props.provider?.displayName ?? driver}
            accentColor={entry?.accentColor}
            showBadge={showInstanceBadge && entry?.accentColor !== undefined}
            badgeContent="none"
            badgeClassName="h-2 min-w-2 px-0"
            iconClassName="size-3 shrink-0 grayscale opacity-60"
          />
        ) : (
          <BotIcon className="size-3 shrink-0" />
        )}
        <span className="inline-flex min-w-0 items-center gap-1 text-foreground/75">
          <span className="min-w-0 truncate">
            {showInstanceBadge ? `${modelLabel} · ${entry.displayName}` : modelLabel}
          </span>
          {effort || speedLabel ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              {effort ? " · " : null}
              {speedLabel ? (
                <span title={`${speedLabel} mode on`} className="inline-flex">
                  <ZapIcon aria-hidden className="size-3 fill-current opacity-80" />
                  <span className="sr-only">{speedLabel} mode on</span>
                </span>
              ) : null}
              {effort}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm font-medium capitalize",
            working
              ? "text-info"
              : failed
                ? "text-error"
                : props.status === "completed"
                  ? "text-success"
                  : "text-muted-foreground",
          )}
        >
          <StatusIcon aria-hidden className="size-3 shrink-0" />
          {props.status.replaceAll("_", " ")}
        </span>
        {props.elapsed}
      </div>
      {metadata.map(({ label, value }) => {
        const Icon = label === "Branch" ? GitBranchIcon : FolderIcon;
        return (
          <div key={label} className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden className="size-3 shrink-0" />
            <span className="sr-only">{label}</span>
            <MiddleTruncate value={value} className="flex" showTitle={false} />
          </div>
        );
      })}
      {preview ? (
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon aria-hidden className="size-3 shrink-0" />
          <MiddleTruncate value={preview} className="flex" showTitle={false} />
        </div>
      ) : null}
    </ThreadHoverCard>
  );
}
