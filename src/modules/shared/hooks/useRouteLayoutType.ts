/**
 * useRouteLayoutType Hook
 *
 * Determines which layout to render based on the current route.
 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { getSidebarId } from "@src/config/sidebarRegistry";

export type LayoutType = "session" | "home" | "standard";

export function useRouteLayoutType(): LayoutType {
  const location = useLocation();
  const pathname = location.pathname;

  return useMemo(() => {
    const sidebarId = getSidebarId(pathname);

    if (!sidebarId) return "standard";

    switch (sidebarId) {
      case "session-sidebar":
        return "session";
      case "home-sidebar":
        return "home";
      default:
        return "standard";
    }
  }, [pathname]);
}
