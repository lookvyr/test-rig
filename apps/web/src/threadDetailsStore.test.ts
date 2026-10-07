import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { useThreadDetailsStore } from "./threadDetailsStore";

describe("thread details keyboard visibility", () => {
  it("toggles the current presentation without losing the other presentation's preference", () => {
    useThreadDetailsStore.setState({
      hiddenByThreadKey: {},
      popoverOpenByThreadKey: {},
      presentationByThreadKey: {},
    });
    const thread = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
    const store = useThreadDetailsStore.getState();
    store.toggle(thread);
    expect(Object.values(useThreadDetailsStore.getState().hiddenByThreadKey)).toEqual([true]);
    store.setPresentation(thread, "popover");
    store.toggle(thread);
    expect(Object.values(useThreadDetailsStore.getState().popoverOpenByThreadKey)).toEqual([true]);
    expect(Object.values(useThreadDetailsStore.getState().hiddenByThreadKey)).toEqual([true]);
    store.setPresentation(thread, "inline");
    store.toggle(thread);
    expect(Object.values(useThreadDetailsStore.getState().hiddenByThreadKey)).toEqual([false]);
  });
});
