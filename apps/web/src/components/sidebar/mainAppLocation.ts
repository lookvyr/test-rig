import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function isAppModalPage(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

let returnHref = "/";
export function MainAppLocationTracker() {
  const location = useLocation();
  useEffect(() => {
    if (!isAppModalPage(location.pathname)) returnHref = location.href;
  }, [location.href, location.pathname]);
  return null;
}

export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: returnHref });
}
