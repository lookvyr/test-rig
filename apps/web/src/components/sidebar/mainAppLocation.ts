import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Settings opens as a modal over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Full-page tools that swap the sidebar footer icons for a Back button. */
export function isSidebarUtilityPage(pathname: string) {
  return pathname === "/pull-requests";
}

let appModalReturnHref: string | null = null;
let mainAppHref: string | null = null;

/** Remembers where Settings and the utility pages lead back to. */
export function MainAppLocationTracker() {
  const location = useLocation();
  useEffect(() => {
    if (isAppModalPage(location.pathname)) return;
    appModalReturnHref = location.href;
    if (!isSidebarUtilityPage(location.pathname)) mainAppHref = location.href;
  }, [location.href, location.pathname]);
  return null;
}

/** Leaves a utility page for the last thread or draft view. */
export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/** Leaves Settings for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
