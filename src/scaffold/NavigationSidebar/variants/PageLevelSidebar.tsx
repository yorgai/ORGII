/**
 * PageLevelSidebar
 *
 * Shared base for second-level sidebars that replace the HomeSidebar when
 * navigating into a specific page (e.g. Dev Record, Settings).
 *
 * Renders inside the same SidebarBase glass/resize shell as HomeSidebar:
 * - h-9 header row (items-end) with a ← back button
 * - Scrollable list of icon + label items with active highlight
 */
import { ChevronLeft, type LucideIcon } from "lucide-react";
import React, { useCallback, useMemo } from "react";

import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";

import SidebarBase from "../SidebarBase";
import { SidebarList } from "../blocks";
import NavigationMenu from "../components/NavigationMenu";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";

// ============================================
// Types
// ============================================

export interface PageLevelSidebarItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface PageLevelSidebarProps {
  /** Label shown next to the back chevron */
  backLabel: string;
  /** Called when the back button is clicked */
  onBack: () => void;
  /** Nav items to display */
  items: PageLevelSidebarItem[];
  /** Key of the currently active item */
  activeKey: string;
  /** Called when an item is clicked */
  onItemClick: (key: string) => void;
}

// ============================================
// Component
// ============================================

const PageLevelSidebar: React.FC<PageLevelSidebarProps> = ({
  backLabel,
  onBack,
  items,
  activeKey,
  onItemClick,
}) => {
  const menuItems = useMemo<NavigationMenuItem[]>(
    () =>
      items.map(({ key, label, icon }) => ({
        id: key,
        key,
        label,
        icon,
      })),
    [items]
  );

  const selectedKeys = useMemo(() => [activeKey], [activeKey]);

  const handleMenuItemClick = useCallback(
    (key: string) => onItemClick(key),
    [onItemClick]
  );

  return (
    <SidebarBase>
      {/* Back header — h-9 aligned to bottom, mirrors TabPill row height */}
      <div className="flex h-9 flex-shrink-0 items-end px-3">
        <LiquidGlassHoverItem
          className="flex h-7 items-center gap-1.5 rounded-full pl-2 pr-3 font-bold text-text-1"
          onClick={onBack}
        >
          <ChevronLeft size={14} strokeWidth={2} />
          <span className="text-[13px]">{backLabel}</span>
        </LiquidGlassHoverItem>
      </div>

      <SidebarList>
        <NavigationMenu
          items={menuItems}
          selectedKeys={selectedKeys}
          onMenuItemClick={handleMenuItemClick}
        />
      </SidebarList>
    </SidebarBase>
  );
};

export default PageLevelSidebar;
