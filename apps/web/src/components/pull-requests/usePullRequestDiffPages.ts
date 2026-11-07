import { useAtomRefresh } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitPullRequestFile,
  PullRequestDiffResult,
  PullRequestRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fnv1a32,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { gitEnvironment } from "../../state/git";
import { useEnvironmentQuery } from "../../state/query";

export interface DiffPage {
  cursor: string | null;
  data: PullRequestDiffResult;
}

/** An updated page invalidates cursors after it; equal refreshes preserve the viewer. */
export function mergeDiffPage(pages: readonly DiffPage[], next: DiffPage): readonly DiffPage[] {
  const index = pages.findIndex((page) => page.cursor === next.cursor);
  if (index === -1) return [...pages, next];
  const previous = pages[index]!.data;
  if (
    previous.patch === next.data.patch &&
    previous.nextCursor === next.data.nextCursor &&
    previous.truncated === next.data.truncated &&
    JSON.stringify(previous.omittedFileStats) === JSON.stringify(next.data.omittedFileStats)
  )
    return pages;
  return [...pages.slice(0, index), next];
}

const parsedPages = new WeakMap<PullRequestDiffResult, ReturnType<typeof parsePage>>();
function parsePage(data: PullRequestDiffResult) {
  const revision = fnv1a32(data.patch);
  const parsed = getRenderablePatch(data.patch, `pull-request-page:${revision}`, {
    compactPartialHunkOffsets: true,
  });
  const omitted = new Map(data.omittedFileStats?.map((file) => [file.path, file]));
  const files =
    parsed?.kind === "files"
      ? parsed.files.map((fileDiff) => {
          const path = resolveFileDiffPath(fileDiff);
          const stats = omitted.get(path) ?? getDiffLineStat([fileDiff]);
          omitted.delete(path);
          const file: GitPullRequestFile = {
            path,
            previousPath: fileDiff.prevName ?? null,
            status:
              fileDiff.type === "new"
                ? "added"
                : fileDiff.type === "deleted"
                  ? "removed"
                  : fileDiff.type.startsWith("rename")
                    ? "renamed"
                    : "modified",
            additions: stats.additions,
            deletions: stats.deletions,
            patch: null,
          };
          return {
            file,
            fileKey: path,
            patch: { kind: "files" as const, files: [fileDiff] },
            version: fnv1a32(`${revision}:${path}`),
          };
        })
      : [];
  return {
    revision,
    files: [
      ...files,
      ...[...omitted.values()].map((stat) => ({
        file: {
          ...stat,
          previousPath: null,
          status: "modified",
          patch: null,
        } satisfies GitPullRequestFile,
        fileKey: stat.path,
        patch: null,
        version: fnv1a32(`${revision}:${stat.path}`),
      })),
    ],
    raw: parsed?.kind === "raw" ? parsed.text : null,
  };
}

/** Cached with the RPC answer so tab switches don't reparse an unchanged diff. */
export function pullRequestDiffPageModel(data: PullRequestDiffResult) {
  let model = parsedPages.get(data);
  if (!model) {
    model = parsePage(data);
    parsedPages.set(data, model);
  }
  return model;
}

export function usePullRequestDiffPages(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  refreshToken: number,
) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<readonly DiffPage[]>([]);
  const query = useEnvironmentQuery(
    gitEnvironment.pullRequestDiff({
      environmentId,
      input: { ...reference, ...(cursor ? { cursor } : {}) },
    }),
  );
  const refreshFirst = useAtomRefresh(
    gitEnvironment.pullRequestDiff({ environmentId, input: reference }),
  );
  const [applied, setApplied] = useState<DiffPage | null>(null);
  if (query.data && (applied?.data !== query.data || applied.cursor !== cursor)) {
    const next = { cursor, data: query.data };
    setApplied(next);
    setPages((current) => mergeDiffPage(current, next));
  }
  const lastRefresh = useRef(refreshToken);
  useEffect(() => {
    if (lastRefresh.current === refreshToken) return;
    lastRefresh.current = refreshToken;
    setCursor(null);
    setApplied(null);
    refreshFirst();
  }, [refreshToken, refreshFirst]);
  const parsed = useMemo(() => pages.map((page) => pullRequestDiffPageModel(page.data)), [pages]);
  const model = useMemo(() => parsed.flatMap((page) => page.files), [parsed]);
  const nextCursor = pages.at(-1)?.data.nextCursor ?? null;
  const loadMore = useCallback(() => {
    if (nextCursor) setCursor(nextCursor);
  }, [nextCursor]);
  return {
    model,
    raw: parsed.flatMap((page) => (page.raw ? [page.raw] : [])),
    revision: parsed[0]?.revision ?? 0,
    truncated: pages.some((page) => page.data.truncated),
    pending: query.isPending,
    error: query.error,
    refresh: query.refresh,
    hasMore: nextCursor !== null,
    canLoadMore: nextCursor !== null && nextCursor !== cursor && !query.isPending && !query.error,
    loadMore,
  };
}
