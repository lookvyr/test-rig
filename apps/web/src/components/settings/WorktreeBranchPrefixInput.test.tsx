import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useEffect: () => undefined,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { WorktreeBranchPrefixInput } from "./WorktreeBranchPrefixInput";

function renderInput(value: string, onValueChange: (value: string) => void) {
  hooks.beginRender();
  const tree = WorktreeBranchPrefixInput({ value, onValueChange }) as ReactElement<
    Record<string, unknown>
  >;
  const input = visitElements(
    tree,
    (element) => element.props["aria-label"] === "Worktree branch prefix",
  );
  if (!input) throw new Error("worktree branch prefix input not found");
  return { tree, input };
}

describe("WorktreeBranchPrefixInput", () => {
  beforeEach(() => hooks.reset());

  it("commits a valid trimmed prefix on blur", () => {
    const onValueChange = vi.fn();
    let rendered = renderInput("test-rig", onValueChange);
    (rendered.input.props.onChange as (event: unknown) => void)({
      currentTarget: { value: "  example/team  " },
    });

    rendered = renderInput("test-rig", onValueChange);
    expect(rendered.input.props["aria-invalid"]).toBeUndefined();
    (rendered.input.props.onBlur as () => void)();

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("example/team");
  });

  it("shows an inline error and does not commit an invalid prefix", () => {
    const onValueChange = vi.fn();
    let rendered = renderInput("test-rig", onValueChange);
    (rendered.input.props.onChange as (event: unknown) => void)({
      currentTarget: { value: "Invalid Prefix" },
    });

    rendered = renderInput("test-rig", onValueChange);
    expect(rendered.input.props["aria-invalid"]).toBe(true);
    expect(
      visitElements(
        rendered.tree,
        (element) => element.props.id === "worktree-branch-prefix-error",
      ),
    ).not.toBeNull();
    (rendered.input.props.onBlur as () => void)();

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
