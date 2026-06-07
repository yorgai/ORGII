import { useEffect } from "react";

import {
  loadSidebarSessions,
  refreshCursorIdeSidebarSessions,
} from "@src/store/session";

import { CURSOR_IDE_REFRESH_INTERVAL_MS } from "../sidebarConnectorUtils";

export function useSidebarSessionRefreshEffects(): void {
  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);

  useEffect(() => {
    const refreshCursorIdeSessions = () => {
      if (document.visibilityState !== "visible") return;
      void refreshCursorIdeSidebarSessions();
    };
    const intervalId = window.setInterval(
      refreshCursorIdeSessions,
      CURSOR_IDE_REFRESH_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", refreshCursorIdeSessions);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        refreshCursorIdeSessions
      );
    };
  }, []);
}
