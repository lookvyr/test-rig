/** A synthetic review summary, used only by the PR workspace test fixture. */
export function summarizeReview(pullRequest) {
  const comments = [...pullRequest.comments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return {
    title: pullRequest.title,
    status:
      pullRequest.state !== "open"
        ? pullRequest.state
        : pullRequest.isDraft
          ? "draft"
          : "open",
    filesChanged: pullRequest.files.length,
    latestComment: comments.at(-1)?.body ?? null,
  };
}
