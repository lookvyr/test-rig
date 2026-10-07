import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_BROWSER_PROFILE_ID,
  type EnvironmentId,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import type { ClosedView, ClosedViewEntry } from "./closedViewStore";
import { openPreviewSession } from "./components/preview/openPreviewSession";
import { useRightPanelStore, type ThreadRightPanelState } from "./rightPanelStore";

export interface ReopenOwnerState {
  environmentKnown: boolean;
  catalogReady: boolean;
  ownerExists: boolean;
  shellLive: boolean;
  panel: ThreadRightPanelState;
}

/** Skip unavailable owners without consuming their history; drop already-open views. */
export function planNextReopen(
  entries: readonly ClosedViewEntry[],
  ownerState: (entry: ClosedViewEntry) => ReopenOwnerState,
) {
  const drop: ClosedViewEntry[] = [];
  for (const entry of entries) {
    const owner = ownerState(entry);
    if (!owner.environmentKnown) {
      if (!owner.catalogReady) break;
      drop.push(entry);
      continue;
    }
    if (!owner.ownerExists) {
      if (owner.shellLive) continue;
      break;
    }
    const alreadyOpen =
      entry.kind === "panel-tab"
        ? owner.panel.isOpen &&
          owner.panel.surfaces.some((surface) => surface.id === entry.surface.id)
        : owner.panel.surfaces.some(
            (surface) => surface.kind === "preview" && surface.resourceId === entry.snapshot.tabId,
          );
    if (alreadyOpen) {
      drop.push(entry);
      continue;
    }
    return { drop, restore: entry };
  }
  return { drop, restore: null };
}

export async function reopenClosedView<E>(
  view: ClosedView,
  options: {
    openPreview: (input: {
      environmentId: EnvironmentId;
      input: PreviewOpenInput;
    }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
    workspaceAvailable: boolean;
  },
): Promise<boolean> {
  const panels = useRightPanelStore.getState();
  if (view.kind === "browser") {
    const result = await openPreviewSession({
      openPreview: options.openPreview,
      threadRef: view.threadRef,
      ...(view.snapshot.navStatus._tag === "Idle" ? {} : { url: view.snapshot.navStatus.url }),
      profileId: view.snapshot.profileId ?? DEFAULT_BROWSER_PROFILE_ID,
      ...(view.snapshot.viewport === undefined ? {} : { viewport: view.snapshot.viewport }),
    });
    if (result._tag === "Failure") return false;
    panels.openBrowser(view.threadRef, result.value.tabId);
    return true;
  }
  const surface = view.surface;
  if (!options.workspaceAvailable && (surface.kind === "file" || surface.kind === "files"))
    return false;
  if (surface.kind === "file")
    panels.openFile(view.threadRef, surface.relativePath, surface.revealLine ?? undefined);
  else if (surface.kind === "preview") panels.openBrowser(view.threadRef, null);
  else panels.open(view.threadRef, surface.kind);
  return true;
}
