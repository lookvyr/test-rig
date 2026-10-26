import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MainAppLocationTracker, isAppModalPage, useCloseAppModal } from "./mainAppLocation";

const state = vi.hoisted(() => ({
  location: { pathname: "/", href: "/" },
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => state.location,
  useNavigate: () => state.navigate,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
let close: ReturnType<typeof useCloseAppModal>;
function Harness() {
  const closeModal = useCloseAppModal();
  useEffect(() => {
    close = closeModal;
  }, [closeModal]);
  return <MainAppLocationTracker />;
}
async function visit(pathname: string, href = pathname) {
  state.location = { pathname, href };
  await act(async () => {
    if (renderer) renderer.update(<Harness />);
    else renderer = create(<Harness />);
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  state.navigate.mockClear();
});

describe("settings modal navigation", () => {
  it("closes a direct Settings URL to the home page before any origin is recorded", async () => {
    await visit("/settings/providers");
    await close();
    expect(state.navigate).toHaveBeenCalledWith({ href: "/" });
  });
  it("returns to the originating thread URL after moving between settings pages", async () => {
    await visit("/env/thread", "/env/thread?diff=working#file");
    await visit("/settings/general");
    await visit("/settings/tools", "/settings/tools?tab=mcp");
    await close();
    expect(state.navigate).toHaveBeenCalledWith({ href: "/env/thread?diff=working#file" });
  });
  it("uses the latest origin when settings is reopened from another page", async () => {
    await visit("/draft/local");
    await visit("/settings/appearance");
    await visit("/pull-requests");
    await visit("/settings/general");
    await close();
    expect(state.navigate).toHaveBeenCalledWith({ href: "/pull-requests" });
  });
  it("recognizes only the retained Settings modal routes", () => {
    expect(isAppModalPage("/settings")).toBe(true);
    expect(isAppModalPage("/settings/providers")).toBe(true);
    expect(isAppModalPage("/settings-backup")).toBe(false);
    expect(isAppModalPage("/usage")).toBe(false);
  });
});
