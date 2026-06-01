import { useEffect } from "react";

import { ROUTES } from "@src/config/routes";
import { preloadRouteByPath } from "@src/router/lazy/preload";

export function useAppShellPreload(): void {
  useEffect(() => {
    const preloadOtherWorkStationApps = () => {
      void import("../../Browser");
      void import("../../DatabaseManager");
      preloadRouteByPath(ROUTES.workStation.kanban.path);
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(preloadOtherWorkStationApps, {
        timeout: 3000,
      });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preloadOtherWorkStationApps, 1500);
    return () => window.clearTimeout(timeoutId);
  }, []);
}
