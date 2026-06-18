import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { useRouteAppMode } from "@src/config/routeViewModeConfig";
import { ROUTES } from "@src/config/routes";
import {
  restoreChatWidthAtom,
  stationChatVisibilityAtom,
} from "@src/store/ui/chatPanelAtom";
import { STATION_MODE, stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  DEFAULT_DOCK_FILTER,
  type DockFilter,
  dockFilterAtom,
} from "@src/store/workstation";

function appModeToDockFilter(
  appMode: ReturnType<typeof useRouteAppMode>
): DockFilter {
  switch (appMode) {
    case "code":
    case "browser":
    case "data":
    case "project":
      return appMode;
    default:
      return "all";
  }
}

export function useAppShellDockFilterSync(): DockFilter {
  const appMode = useRouteAppMode();
  const dockFilter = useAtomValue(dockFilterAtom);
  const setDockFilter = useSetAtom(dockFilterAtom);
  const restoreChatWidth = useSetAtom(restoreChatWidthAtom);
  const setStationChatVisibility = useSetAtom(stationChatVisibilityAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const location = useLocation();
  const isWorkstationBasePath =
    location.pathname === ROUTES.workStation.base.path;
  // When Settings occupies the chat-panel slot, the WorkStation pane is
  // still rendered to the right and the user can freely switch apps in it.
  // The route is `/orgii/app/settings/*` which doesn't encode a workstation
  // app, so route → atom sync would always snap dockFilter back to the
  // fallback (`"code"`) and clobber the user's choice. Leave the atom alone.
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");

  useEffect(() => {
    if (isWorkstationBasePath) {
      setDockFilter(DEFAULT_DOCK_FILTER);
      setStationMode(STATION_MODE.MY_STATION);
      setStationChatVisibility((prev) => ({
        ...prev,
        [STATION_MODE.MY_STATION]: true,
      }));
      restoreChatWidth();
      return;
    }
    if (isSettingsRoute) return;
    const nextDockFilter = appModeToDockFilter(appMode);
    setDockFilter(nextDockFilter);
  }, [
    isWorkstationBasePath,
    isSettingsRoute,
    appMode,
    restoreChatWidth,
    setDockFilter,
    setStationChatVisibility,
    setStationMode,
  ]);

  return dockFilter;
}
