import { useEffect } from "react";

import {
  loadSidebarSessions,
  refreshCursorIdeSidebarSessions,
} from "@src/store/session";

import {
  CURSOR_IDE_ACTIVE_REFRESH_INTERVAL_MS,
  CURSOR_IDE_IDLE_REFRESH_INTERVAL_MS,
} from "../sidebarConnectorUtils";

export function useSidebarSessionRefreshEffects(): void {
  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);

  useEffect(() => {
    let intervalId: number | null = null;

    const getRefreshInterval = () =>
      document.hasFocus()
        ? CURSOR_IDE_ACTIVE_REFRESH_INTERVAL_MS
        : CURSOR_IDE_IDLE_REFRESH_INTERVAL_MS;

    const refreshCursorIdeSessions = () => {
      if (document.visibilityState !== "visible") return;
      void refreshCursorIdeSidebarSessions();
    };

    const scheduleRefresh = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(
        refreshCursorIdeSessions,
        getRefreshInterval()
      );
    };

    const handleActivityStateChange = () => {
      refreshCursorIdeSessions();
      scheduleRefresh();
    };

    scheduleRefresh();
    document.addEventListener("visibilitychange", handleActivityStateChange);
    window.addEventListener("focus", handleActivityStateChange);
    window.addEventListener("blur", scheduleRefresh);
    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        handleActivityStateChange
      );
      window.removeEventListener("focus", handleActivityStateChange);
      window.removeEventListener("blur", scheduleRefresh);
    };
  }, []);
}
