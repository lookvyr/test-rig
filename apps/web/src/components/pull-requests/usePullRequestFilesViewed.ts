import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { gitEnvironment } from "../../state/git";
import { useEnvironmentQuery } from "../../state/query";
import { filesViewedScope } from "./filesViewedStore";

/** Share optimistic, batched GitHub progress across mounted readers of the same PR. */
export function usePullRequestFilesViewed(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  refreshToken: number,
) {
  const query = useEnvironmentQuery(
    gitEnvironment.pullRequestFilesViewed({ environmentId, input: reference }),
  );
  const refreshQuery = query.refresh;
  const lastRefresh = useRef(refreshToken);
  useEffect(() => {
    if (lastRefresh.current === refreshToken) return;
    lastRefresh.current = refreshToken;
    refreshQuery();
  }, [refreshToken, refreshQuery]);
  const scope = filesViewedScope({ environmentId, reference });
  const overlay = useSyncExternalStore(scope.subscribe, scope.getSnapshot);
  const pending = useSyncExternalStore(scope.subscribe, scope.getPendingSnapshot);
  const states = useMemo(() => {
    const states = new Map(query.data?.files.map((file) => [file.path, file.state]));
    for (const [path, viewed] of overlay) states.set(path, viewed ? "viewed" : "unviewed");
    return states;
  }, [query.data, overlay]);
  return {
    states,
    setViewed: (paths: readonly string[], viewed: boolean) => {
      for (const path of paths) scope.setViewed(path, viewed);
    },
    pending,
    enabled: query.data !== null && !query.error,
    error: query.error,
    refresh: query.refresh,
    truncated: query.data?.truncated ?? false,
  };
}
