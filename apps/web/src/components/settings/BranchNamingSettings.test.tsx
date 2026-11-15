import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const state = vi.hoisted(() => ({ mixed: true, update: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useRef: reactHookHarness.useRef };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => DEFAULT_SERVER_SETTINGS,
  useScopedSettingsMixed: (keys: readonly string[]) =>
    keys[0] === "branchNamePrefix" && state.mixed,
  useUpdateScopedSettings: () => state.update,
}));
import { BranchNamingSettings } from "./BranchNamingSettings";

function render() {
  hooks.beginRender();
  return BranchNamingSettings();
}
function input() {
  const element = visitElements(
    render(),
    (element) => element.props["aria-label"] === "Branch prefix",
  );
  if (!element) throw new Error("Missing prefix input");
  return element;
}

describe("scoped branch naming controls", () => {
  beforeEach(() => {
    hooks.reset();
    vi.clearAllMocks();
    state.mixed = true;
  });
  it("does not replace mixed prefixes when an untouched input loses focus", () => {
    const prefix = input();
    expect(prefix.props.placeholder).toBe("Mixed");
    (prefix.props.onBlur as (event: unknown) => void)({ target: { value: "" } });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("applies an explicitly edited empty prefix to mixed targets", () => {
    const prefix = input();
    (prefix.props.onChange as () => void)();
    (prefix.props.onBlur as (event: unknown) => void)({ target: { value: "" } });
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ branchNamePrefix: "" });
  });
  it("offers a reset only when the value differs from the default", () => {
    state.mixed = false;
    const reset = visitElements(render(), (element) => element.props.label === "branch prefix");
    expect(reset).toBeNull();
  });
});
