import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  type TabFocusRequest,
  focusTabAtom,
} from "@src/store/workstation/tabRegistry";

/**
 * Focus a tab inside the unified workstation pane registry.
 *
 * Phase 1a removed the host-based route navigation that used to live here:
 * the unified pane tree owns focus, and the AppShell's `appMode` follows
 * the pane through other means (status bar / pane id derivation). Phase 2
 * will collapse the AppShell entirely, at which point even that
 * derivation goes away.
 */
export function useFocusTab(): (request: TabFocusRequest) => void {
  const setStationMode = useSetAtom(stationModeAtom);
  const focusTab = useSetAtom(focusTabAtom);

  return useCallback(
    (request: TabFocusRequest) => {
      setStationMode("my-station");
      focusTab(request);
    },
    [setStationMode, focusTab]
  );
}
