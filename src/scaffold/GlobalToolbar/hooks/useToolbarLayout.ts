/**
 * useToolbarLayout Hook
 *
 * Manages toolbar layout calculations (sidebar visibility, padding, etc.)
 */
import { useAtomValue } from "jotai";
import { useLocation } from "react-router-dom";

import {
  hasForceVisibleSidebar,
  hasSidebar,
} from "@src/config/sidebarRegistry";
import useIsShowSidebar from "@src/hooks/ui/sidebar/useIsShowSidebar";
import { useSidebarState } from "@src/hooks/ui/sidebar/useSidebarState";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";

export interface UseToolbarLayoutReturn {
  isMacOS: boolean;
  hasMacOSSidebar: boolean;
  isSidebarCollapsed: boolean;
  expandSidebar: () => void;
  shouldShowUnfoldButton: boolean;
  needsTrafficLightPadding: boolean;
}

export function useToolbarLayout(): UseToolbarLayoutReturn {
  const location = useLocation();
  const isShowSidebar = useIsShowSidebar();
  const isFullscreen = useAtomValue(windowFullscreenAtom);

  const isMacOS = navigator.platform.toLowerCase().includes("mac");

  const hasMacOSSidebar = hasSidebar(location.pathname);
  const sidebarIsForcedVisible = hasForceVisibleSidebar(location.pathname);

  const { isCollapsed: isSidebarCollapsed, expand: expandSidebar } =
    useSidebarState();

  const isEffectivelyCollapsed = isSidebarCollapsed && !sidebarIsForcedVisible;
  const shouldShowUnfoldButton =
    isMacOS && hasMacOSSidebar && isEffectivelyCollapsed && isShowSidebar;

  const needsTrafficLightPadding =
    isMacOS && (!isShowSidebar || isEffectivelyCollapsed) && !isFullscreen;

  return {
    isMacOS,
    hasMacOSSidebar,
    isSidebarCollapsed,
    expandSidebar,
    shouldShowUnfoldButton,
    needsTrafficLightPadding,
  };
}
