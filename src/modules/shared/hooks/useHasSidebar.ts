/**
 * useHasSidebar Hook
 *
 * Determines if the current route should have sidebar padding
 *
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

/**
 * Hook to check if current route has a visible sidebar
 * Used for applying padding adjustments
 */
export function useHasSidebar(): boolean {
  const location = useLocation();
  const pathname = location.pathname;
  const isSidebarCollapsed = useAtomValue(sidebarCollapsedAtom);

  return useMemo(() => {
    // Only applies to editor routes when sidebar is expanded
    if (isSidebarCollapsed) {
      return false;
    }

    const specialRoutes = [ROUTES.workStation.code.path];

    return specialRoutes.some((route) => pathname.includes(route));
  }, [pathname, isSidebarCollapsed]);
}
