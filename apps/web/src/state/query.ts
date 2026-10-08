import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
): EnvironmentQueryView<A> & { readonly hasValue: boolean } {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  const recovery = useRef<{ atom: typeof selectedAtom; attempted: boolean }>({
    atom: selectedAtom,
    attempted: false,
  });
  const interrupted = result._tag === "Failure" && Cause.hasInterruptsOnly(result.cause);
  useEffect(() => {
    if (recovery.current.atom !== selectedAtom || result._tag === "Success") {
      recovery.current = { atom: selectedAtom, attempted: false };
    }
    if (atom === null || !interrupted || result.waiting || recovery.current.attempted) return;
    // A canceled cached read can survive switching scopes. Retry once while mounted;
    // repeated cancellation stays actionable rather than creating a refresh loop.
    recovery.current.attempted = true;
    refresh();
  }, [atom, selectedAtom, interrupted, result, refresh]);
  return environmentQueryView(result, refresh, atom !== null);
}

function environmentQueryView<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  refresh: () => void,
  enabled = true,
): EnvironmentQueryView<A> & { readonly hasValue: boolean } {
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    hasValue: enabled && Option.isSome(AsyncResult.value(result)),
    error:
      result._tag === "Failure"
        ? Cause.hasInterruptsOnly(result.cause)
          ? result.waiting
            ? null
            : "The request was canceled. Refresh to try again."
          : formatError(result.cause)
        : null,
    isPending: enabled && result.waiting,
    refresh,
  };
}

/** Release an offscreen query while retaining its last result for the same identity. */
export function useLeasedEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
  enabled: boolean,
): EnvironmentQueryView<A> {
  const query = useEnvironmentQuery(enabled ? atom : null);
  const [retained, setRetained] = useState<{ readonly atom: typeof atom; readonly data: A } | null>(
    null,
  );
  if (atom !== null && query.data !== null) {
    if (retained?.atom !== atom || retained.data !== query.data) {
      setRetained({ atom, data: query.data });
    }
  } else if (retained !== null && retained.atom !== atom) {
    setRetained(null);
  }
  return { ...query, data: query.data ?? (retained?.atom === atom ? retained.data : null) };
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
