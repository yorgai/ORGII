import { useAtomValue } from "jotai";

import {
  PRIMARY_SIDEBAR_COMFORT_SURFACE_BG_CLASS,
  PRIMARY_SIDEBAR_SURFACE_BG_CLASS,
} from "@src/config/workstation/tokens";
import { workStationInternalLayoutModeAtom } from "@src/store/ui/workStationAtom";

export interface PrimarySidebarSurfaceTokens {
  isComfortLayout: boolean;
  /** Root panel background (PrimarySidebarLayout shell). */
  surfaceBgClass: string;
  /** VirtualizedStickyTree sticky header rows + container. */
  stickyBgClass: string;
}

export function usePrimarySidebarSurface(): PrimarySidebarSurfaceTokens {
  const layoutMode = useAtomValue(workStationInternalLayoutModeAtom);
  const isComfortLayout = layoutMode === "comfort";

  return {
    isComfortLayout,
    surfaceBgClass: isComfortLayout
      ? PRIMARY_SIDEBAR_COMFORT_SURFACE_BG_CLASS
      : PRIMARY_SIDEBAR_SURFACE_BG_CLASS,
    stickyBgClass: isComfortLayout
      ? PRIMARY_SIDEBAR_COMFORT_SURFACE_BG_CLASS
      : PRIMARY_SIDEBAR_SURFACE_BG_CLASS,
  };
}
