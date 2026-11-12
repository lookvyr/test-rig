import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Settings opens as a modal over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

let appModalReturnHref: string | null = null;

/** Remembers which page Settings returns to when it closes. */
export function MainAppLocationTracker() {
  const location = useLocation();
  useEffect(() => {
    if (!isAppModalPage(location.pathname)) appModalReturnHref = location.href;
  }, [location.href, location.pathname]);
  return null;
}

/** Leaves Settings for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? "/" });
}
