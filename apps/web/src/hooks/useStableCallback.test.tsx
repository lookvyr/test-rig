import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it } from "@effect/vitest";
import { useStableCallback } from "./useStableCallback";

it("keeps event identity while calling the latest committed implementation", () => {
  let callback: (value: string) => string = () => "unmounted";
  function Harness({ prefix }: { prefix: string }) {
    const stable = useStableCallback((value: string) => prefix + value);
    useLayoutEffect(() => {
      callback = stable;
    });
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness prefix="before:" />);
  });
  const first = callback;
  expect(callback("paste")).toBe("before:paste");
  act(() => {
    renderer.update(<Harness prefix="after:" />);
  });
  expect(callback).toBe(first);
  expect(callback("paste")).toBe("after:paste");
  act(() => renderer.unmount());
});
