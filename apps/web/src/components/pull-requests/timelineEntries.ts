import type { PullRequestActivity } from "@t3tools/contracts";

/** Inline replies are represented by their review thread, rather than repeated as loose comments. */
export function pullRequestTimelineEntries(activity: PullRequestActivity) {
  const threadedIds = new Set(
    activity.reviewThreads.flatMap((thread) => thread.comments.map((comment) => comment.id)),
  );
  return [
    ...activity.comments
      .filter((comment) => !threadedIds.has(comment.id))
      .map((comment) => ({
        kind: "comment" as const,
        id: `comment:${comment.id}`,
        at: comment.createdAt,
        comment,
      })),
    ...activity.reviewThreads
      .filter((thread) => thread.comments.length > 0)
      .map((thread) => ({
        kind: "thread" as const,
        id: `thread:${thread.id}`,
        at: thread.comments[0]!.createdAt,
        thread,
      })),
    ...activity.commits.map((commit) => ({
      kind: "commit" as const,
      id: `commit:${commit.oid}`,
      at: commit.committedDate,
      commit,
    })),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}
