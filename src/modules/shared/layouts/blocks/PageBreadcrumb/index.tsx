/**
 * PageBreadcrumb Component
 *
 * Displays tab icon + name using shared PANEL_HEADER_TOKENS.
 * When sidebar is collapsed, clicking triggers the floating sidebar.
 * Used in split panel headers.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowLeftRight } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";

import {
  findRouteByPath,
  getIconComponentForPath,
  getLabelForPath,
} from "@src/config/routes";
import { useRouteLabel } from "@src/hooks/i18n";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { hoverSidebarOpenAtom } from "@src/store/ui/hoverSidebarAtom";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

import { PANEL_HEADER_TOKENS } from "../PanelHeader";

// ============================================
// Component
// ============================================

export interface PageBreadcrumbProps {
  /** Optional custom className */
  className?: string;
}

const PageBreadcrumb: React.FC<PageBreadcrumbProps> = ({ className = "" }) => {
  const location = useLocation();
  const isSidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const setIsHoverSidebarOpen = useSetAtom(hoverSidebarOpenAtom);
  const [ref, isHovered] = useSafeHover<HTMLDivElement>();
  const { getTranslatedLabelForPath } = useRouteLabel();

  // Get current route info
  const currentRoute = useMemo(() => {
    const path = location.pathname;

    // Use route config
    const routeInfo = findRouteByPath(path);
    if (!routeInfo) return null;

    const staticLabel = getLabelForPath(path);
    const label = getTranslatedLabelForPath(staticLabel);
    const IconComponent = getIconComponentForPath(path);

    return { label, IconComponent };
  }, [location.pathname, getTranslatedLabelForPath]);

  // Handle click - trigger floating sidebar when collapsed
  const handleClick = useCallback(() => {
    if (isSidebarCollapsed) {
      setIsHoverSidebarOpen(true);
    }
  }, [isSidebarCollapsed, setIsHoverSidebarOpen]);

  if (!currentRoute) {
    return null;
  }

  // Show ArrowLeftRight icon on hover when sidebar is collapsed
  const IconComponent =
    isSidebarCollapsed && isHovered
      ? ArrowLeftRight
      : currentRoute.IconComponent;

  return (
    <div
      ref={ref}
      className={`flex h-7 items-center gap-2 rounded-full px-2 transition-colors ${
        isSidebarCollapsed ? "active:bg-bg-4 cursor-pointer hover:bg-bg-3" : ""
      } ${className}`}
      onClick={handleClick}
    >
      {IconComponent && (
        <IconComponent
          size={PANEL_HEADER_TOKENS.iconSize}
          className="text-text-2"
        />
      )}
      <span
        className="font-medium text-text-1"
        style={{ fontSize: PANEL_HEADER_TOKENS.fontSize }}
      >
        {currentRoute.label}
      </span>
    </div>
  );
};

export default PageBreadcrumb;
