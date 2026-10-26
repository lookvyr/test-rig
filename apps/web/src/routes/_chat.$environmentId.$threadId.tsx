import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { BackgroundThreadContext } from "../components/chat/backgroundThread";
import ChatView from "../components/ChatView";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "../rightPanelStore";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef, resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  useEnvironmentThreadRefs,
  useThreadDetail,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

export function ChatThreadRouteView({
  params,
  background = false,
}: {
  params: { environmentId: string; threadId: string };
  background?: boolean;
}) {
  const navigate = useNavigate();
  const { environmentId, threadId } = params;
  const threadRef = useMemo(
    () => resolveThreadRouteRef({ environmentId, threadId }),
    [environmentId, threadId],
  );
  const shell = useEnvironmentQuery(
    threadRef === null ? null : environmentShell.stateAtom(threadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const serverThreadStatus = useThreadStatus(threadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(threadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const environmentHasServerThreads = environmentThreadRefs.length > 0;
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = Boolean(
    serverThreadDetail &&
    (serverThreadDetail.projection.runs.length > 0 ||
      serverThreadDetail.projection.thread.activeProviderThreadId !== null),
  );
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (background || !threadRef || !bootstrapComplete) {
      return;
    }

    if (renderState === "missing" && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [background, bootstrapComplete, environmentHasAnyThreads, navigate, renderState, threadRef]);

  useEffect(() => {
    if (background || !threadRef || !serverThreadShell?.sideOfThreadId) return;
    const parentRef = scopeThreadRef(threadRef.environmentId, serverThreadShell.sideOfThreadId);
    useRightPanelStore.getState().openSideChat(parentRef, threadRef.threadId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: parentRef.environmentId, threadId: parentRef.threadId },
      replace: true,
    });
  }, [background, navigate, serverThreadShell?.sideOfThreadId, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);

  if (!threadRef || serverThreadShell?.sideOfThreadId) {
    return null;
  }

  return (
    <SidebarInset
      inert={background}
      className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh"
    >
      <BackgroundThreadContext value={background}>
        {renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
            threadSyncPhase={threadSyncPhase}
          />
        ) : null}
      </BackgroundThreadContext>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: () => null,
});
