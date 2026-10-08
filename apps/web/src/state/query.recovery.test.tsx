import { RegistryContext } from "@effect/atom-react";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { useEnvironmentQuery } from "./query";

it("recovers a mounted canceled query through the real atom registry", async () => {
  const registry = AtomRegistry.make();
  let requests = 0;
  const atom = Atom.make(
    Effect.suspend(() =>
      ++requests === 1 ? Effect.interrupt : Effect.succeed("uncommitted changes"),
    ),
  );
  const observed: Array<ReturnType<typeof useEnvironmentQuery<string, never>>> = [];
  function Probe() {
    const view = useEnvironmentQuery(atom);
    useEffect(() => {
      observed.push(view);
    }, [view]);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <Probe />
        </RegistryContext.Provider>,
      );
    });
    expect(requests).toBe(2);
    expect(observed.at(-1)?.data).toBe("uncommitted changes");
    expect(observed.at(-1)?.error).toBeNull();
    expect(observed.at(-1)?.isPending).toBe(false);
  } finally {
    act(() => renderer?.unmount());
    registry.dispose();
  }
});
