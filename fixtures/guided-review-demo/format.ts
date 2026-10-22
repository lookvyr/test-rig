const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 5m", "3h ago", "in 2d". Rounds toward zero so "in 59m" never reads "in 1h". */
export function formatDue(dueAt: number, now: number): string {
  const delta = dueAt - now;
  const abs = Math.abs(delta);
  const value =
    abs >= DAY
      ? `${Math.trunc(abs / DAY)}d`
      : abs >= HOUR
        ? `${Math.trunc(abs / HOUR)}h`
        : `${Math.max(1, Math.trunc(abs / MINUTE))}m`;
  return delta >= 0 ? `in ${value}` : `${value} ago`;
}
