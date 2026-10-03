import type {
  ThreadLinkedPullRequest,
  ThreadPullRequestKey,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
export function legacyThreadPullRequestKey(
  linked: Pick<ThreadLinkedPullRequest, "repository" | "number" | "url">,
): ThreadPullRequestKey {
  let host = "unknown";
  try {
    host = new URL(linked.url).hostname;
  } catch {
    /* Preserve unreadable legacy links without guessing a host. */
  }
  return {
    host: host.toLowerCase(),
    repository: linked.repository.trim().toLowerCase(),
    number: linked.number,
  };
}
export function threadPullRequestKeysEqual(
  left: ThreadPullRequestKey,
  right: ThreadPullRequestKey,
): boolean {
  return (
    left.host.trim().toLowerCase() === right.host.trim().toLowerCase() &&
    left.repository.trim().toLowerCase() === right.repository.trim().toLowerCase() &&
    left.number === right.number
  );
}
/** Older V2 event payloads stored one link; an explicit empty array means it was unlinked. */
export function threadPullRequestsOf(thread: {
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
}): ReadonlyArray<ThreadPullRequestLink> {
  if (thread.pullRequests !== undefined) return thread.pullRequests;
  const linked = thread.linkedPullRequest;
  return linked == null
    ? []
    : [
        {
          ...legacyThreadPullRequestKey(linked),
          url: linked.url,
          source: "manual",
          linkedAt: "1970-01-01T00:00:00.000Z",
          snapshot: null,
          stack: null,
        },
      ];
}
