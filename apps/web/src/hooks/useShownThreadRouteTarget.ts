import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useMatches } from "@tanstack/react-router";
import { useState } from "react";

import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import type { ThreadRouteTarget } from "../threadRoutes";
import { useThreadRouteTarget } from "./useThreadRouteTarget";

function threadRouteTargetKey(target: ThreadRouteTarget | null) {
  if (!target) return null;
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
}

/** Modal pages (Settings, Usage) render over the thread that opened them; that thread stays the shown one. */
export function useShownThreadRouteTarget() {
  const routeTarget = useThreadRouteTarget();
  // Read matches, not location, so this agrees with the params useThreadRouteTarget reads.
  const modalOpen = useMatches({
    select: (matches) => matches.some((match) => isAppModalPage(match.pathname)),
  });
  const [backgroundTarget, setBackgroundTarget] = useState(routeTarget);
  if (!modalOpen && threadRouteTargetKey(backgroundTarget) !== threadRouteTargetKey(routeTarget)) {
    setBackgroundTarget(routeTarget);
  }
  return { shownTarget: modalOpen ? backgroundTarget : routeTarget, modalOpen };
}
