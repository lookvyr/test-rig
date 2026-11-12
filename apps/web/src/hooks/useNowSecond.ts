import { useSyncExternalStore } from "react";

/**
 * One shared second clock for every ticking label. Each tick lands on a
 * wall-clock second, so all subscribers update in the same frame instead of
 * each running its own interval on its own phase.
 */
let nowSecond = currentSecond();
let timerId: number | null = null;
const listeners = new Set<() => void>();

function currentSecond(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

function schedule(): void {
  timerId = window.setTimeout(
    () => {
      timerId = null;
      nowSecond = currentSecond();
      for (const listener of listeners) listener();
      // A listener may have unsubscribed the last subscriber, or re-armed the clock.
      if (listeners.size > 0 && timerId === null) schedule();
    },
    1000 - (Date.now() % 1000),
  );
}

export const secondTick = {
  subscribe(listener: () => void): () => void {
    if (listeners.size === 0) {
      nowSecond = currentSecond();
      schedule();
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };
  },
  getSnapshot(): number {
    // With no timer running the cached second is stale; re-read it.
    if (timerId === null) nowSecond = currentSecond();
    return nowSecond;
  },
};

/** Epoch ms floored to the second, re-rendering on each shared tick. */
export function useNowSecond(): number {
  return useSyncExternalStore(secondTick.subscribe, secondTick.getSnapshot, secondTick.getSnapshot);
}
