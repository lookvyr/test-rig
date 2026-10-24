const THREAD_FIND_QUERY_EVENT = "test-rig:thread-find-query";
const PENDING_FIND_MS = 30_000;

export interface ThreadFindQuery {
  readonly query: string;
  readonly messageId?: string;
}
let pendingFind: (ThreadFindQuery & { readonly threadKey: string; readonly at: number }) | null =
  null;

/** Opens find in the addressed environment and thread, including after navigation mounts it. */
export function requestThreadFindQuery(threadKey: string, find: ThreadFindQuery): void {
  pendingFind = { threadKey, at: Date.now(), ...find };
  window.dispatchEvent(new Event(THREAD_FIND_QUERY_EVENT));
}

export function takeThreadFindQuery(threadKey: string): ThreadFindQuery | null {
  if (pendingFind?.threadKey !== threadKey) return null;
  const { at, threadKey: _threadKey, ...find } = pendingFind;
  pendingFind = null;
  return Date.now() - at < PENDING_FIND_MS ? find : null;
}

export function subscribeThreadFindQuery(listener: () => void): () => void {
  window.addEventListener(THREAD_FIND_QUERY_EVENT, listener);
  return () => window.removeEventListener(THREAD_FIND_QUERY_EVENT, listener);
}

/** Find uses literal rendered text, so choose a matching word as spelled in the snippet. */
export function findForMessageMatch(
  match: { readonly snippet: string; readonly messageId?: string },
  query: string,
): ThreadFindQuery {
  const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const words = match.snippet.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  const longest = [...tokens].sort((left, right) => right.length - left.length);
  const word =
    longest.flatMap((token) =>
      words.filter((candidate) => fold(candidate).startsWith(fold(token))),
    )[0] ??
    longest.flatMap((token) =>
      words.filter((candidate) => fold(candidate).includes(fold(token))),
    )[0];
  return { query: word ?? query, ...(match.messageId ? { messageId: match.messageId } : {}) };
}
