import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useContext, useMemo } from "react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function formatError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return environmentQueryView(result, refresh, atom !== null);
}

function environmentQueryView<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  refresh: () => void,
  enabled = true,
): EnvironmentQueryView<A> {
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatError(result.cause) : null,
    isPending: enabled && result.waiting,
    refresh,
  };
}

/** Subscribe to a variable number of queries while preserving their display order. */
export function useEnvironmentQueries<A, E>(
  atoms: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<A, E>>>,
): ReadonlyArray<EnvironmentQueryView<A>> {
  const registry = useContext(RegistryContext);
  const combined = useMemo(() => Atom.make((get) => atoms.map((atom) => get(atom))), [atoms]);
  const results = useAtomValue(combined);
  return useMemo(
    () =>
      results.map((result, index) =>
        environmentQueryView(result, () => registry.refresh(atoms[index]!)),
      ),
    [atoms, registry, results],
  );
}
