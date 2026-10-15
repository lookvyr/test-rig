import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useTerminalFocusStore } from "./terminalFocus";

/** Reveal and focus an existing terminal in its owning panel, without opening another PTY. */
export function revealThreadTerminal(threadRef: ScopedThreadRef, terminalId: string) {
  const panels = useRightPanelStore.getState();
  const surface = selectThreadRightPanelState(panels.byThreadKey, threadRef).surfaces.find(
    (surface) => surface.kind === "terminal" && surface.terminalIds.includes(terminalId),
  );
  if (surface) {
    panels.activateTerminal(threadRef, surface.id, terminalId);
    panels.activateSurface(threadRef, surface.id);
  } else {
    useTerminalUiStateStore.getState().ensureTerminal(threadRef, terminalId, {
      open: true,
      active: true,
    });
  }
  useTerminalFocusStore.getState().requestFocus(threadRef, terminalId);
}
