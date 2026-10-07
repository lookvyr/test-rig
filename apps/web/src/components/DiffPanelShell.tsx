import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "flex shrink-0 items-center justify-between gap-2",
    mode === "embedded" ? "px-2" : "px-4",
    shouldUseDragRegion
      ? "drag-region min-h-[52px] border-b border-border wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
      : "border-b border-border",
  );
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
      aria-busy={props.pending ?? false}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          props.pending ? "opacity-0" : "diff-panel-reveal",
        )}
        inert={props.pending}
        aria-hidden={props.pending || undefined}
        data-review-ready={!props.pending}
      >
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
        {props.children}
      </div>
      {props.pending && (
        <div className="absolute inset-0">
          <DiffPanelPlaceholder />
        </div>
      )}
    </div>
  );
}

export function DiffPanelHeaderSkeleton() {
  return (
    <>
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="flex shrink-0 gap-1">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
    </>
  );
}

function DiffFileHeaderSkeleton({ titleClassName }: { titleClassName: string }) {
  return (
    <div className="flex h-8 items-center gap-2 px-2 pr-3">
      <div className="flex size-5 shrink-0 items-center justify-center">
        <Skeleton className="size-2.5 rounded-[2px]" />
      </div>
      <Skeleton className="size-5 shrink-0 rounded-md" />
      <Skeleton className={cn("h-3 rounded-full", titleClassName)} />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton className="h-3 w-5 rounded-full" />
        <Skeleton className="h-3 w-5 rounded-full" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton({ contentClassName }: { contentClassName: string }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-2.5 w-5 shrink-0 rounded-full" />
      <Skeleton className={cn("h-2.5 rounded-full", contentClassName)} />
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div
      className="diff-panel-placeholder min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleClassName="w-1/2 max-w-64" />
      <div className="flex h-6 items-center gap-2 px-2 pr-3">
        <div className="h-px flex-1 bg-border/40" />
        <Skeleton className="h-2.5 w-24 rounded-full" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton contentClassName="w-2/3" />
        <DiffCodeLineSkeleton contentClassName="w-4/5" />
        <DiffCodeLineSkeleton contentClassName="w-3/5" />
      </div>
      <DiffFileHeaderSkeleton titleClassName="w-2/5 max-w-52" />
      <DiffFileHeaderSkeleton titleClassName="w-3/5 max-w-72" />
      <span className="sr-only">{props.label}</span>
    </div>
  );
}

/** Shared by the lazy-code fallback and the initial Git-data wait. */
export function DiffPanelPlaceholder() {
  return (
    <div
      className="diff-panel-placeholder flex h-full min-h-0 w-full flex-col bg-background"
      role="status"
      aria-label="Reading changes"
    >
      <div
        aria-hidden
        className="flex h-20 shrink-0 items-start justify-between border-b border-border px-3 py-3"
      >
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div aria-hidden className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-20" />
      </div>
      <div aria-hidden className="space-y-3 px-3 py-4">
        <Skeleton className="h-3 w-2/5 max-w-60" />
        <Skeleton className="h-2.5 w-3/5 max-w-96" />
        <Skeleton className="h-2.5 w-1/2 max-w-80" />
      </div>
      <p className="diff-panel-loading-label px-3 text-xs text-muted-foreground">
        Reading changes…
      </p>
    </div>
  );
}
