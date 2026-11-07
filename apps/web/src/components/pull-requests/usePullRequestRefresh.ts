import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { pullRequestEnvironment } from "../../state/pullRequests";

/** Keep a mounted review current after host writes, explicit refreshes, and returning to the app. */
export function usePullRequestRefresh({
  environmentId,
  reference,
  refreshVersion,
  revision,
  detailPending,
  refreshDetail,
  refreshRelated,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef | null;
  refreshVersion: number;
  revision: string | null;
  detailPending: boolean;
  refreshDetail: () => void;
  refreshRelated: () => void;
}) {
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate);
  const notifications = useEnvironmentQuery(
    pullRequestEnvironment.refreshes({ environmentId, input: {} }),
  );
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const refresh = async () => {
    if (!reference || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await invalidate({ environmentId, input: { reference } });
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  };
  const refreshLatest = useEffectEvent(refresh);
  const backgroundRevision = useRef<string | null>(null);
  const notify = useEffectEvent(() => {
    backgroundRevision.current = null;
    refreshDetail();
    refreshRelated();
  });
  const lastVersion = useRef(refreshVersion);
  useEffect(() => {
    if (lastVersion.current === refreshVersion) return;
    lastVersion.current = refreshVersion;
    void refreshLatest();
  }, [refreshVersion]);
  const lastNotification = useRef(notifications.data);
  useEffect(() => {
    if (lastNotification.current === notifications.data) return;
    lastNotification.current = notifications.data;
    if (notifications.data !== null) notify();
  }, [notifications.data]);
  const updateRelated = useEffectEvent(refreshRelated);
  useEffect(() => {
    if (detailPending || backgroundRevision.current === null) return;
    const previous = backgroundRevision.current;
    backgroundRevision.current = null;
    if (revision !== null && previous !== revision) updateRelated();
  }, [detailPending, revision]);
  useLiveRefresh(
    () => {
      if (detailPending) return;
      backgroundRevision.current = revision;
      refreshDetail();
    },
    {
      enabled: reference !== null,
      key: JSON.stringify([
        environmentId,
        reference?.projectId,
        reference?.host,
        reference?.repository,
        reference?.number,
      ]),
    },
  );
  return { refresh, refreshing };
}
