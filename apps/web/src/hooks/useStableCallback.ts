import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable event callback that invokes the latest committed implementation. */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
