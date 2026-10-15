import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface TerminalFocusRequest {
  threadRef: ScopedThreadRef;
  terminalId: string;
}

export const useTerminalFocusStore = create<{
  request: TerminalFocusRequest | null;
  requestFocus: (threadRef: ScopedThreadRef, terminalId: string) => void;
  completeRequest: (request: TerminalFocusRequest) => void;
}>((set) => ({
  request: null,
  requestFocus: (threadRef, terminalId) => set({ request: { threadRef, terminalId } }),
  completeRequest: (request) =>
    set((state) => (state.request === request ? { request: null } : state)),
}));

export type TerminalFocusOwner = "drawer" | "right-panel";

export function getTerminalFocusOwner(): TerminalFocusOwner | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  if (!activeElement.isConnected) return null;
  const owner = activeElement.closest<HTMLElement>("[data-terminal-owner]")?.dataset.terminalOwner;
  if (owner === "drawer" || owner === "right-panel") return owner;
  return null;
}

export function isTerminalFocused(): boolean {
  return getTerminalFocusOwner() !== null;
}
