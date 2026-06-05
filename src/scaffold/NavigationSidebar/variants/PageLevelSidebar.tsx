/**
 * PageLevelSidebar
 *
 * Shared base for second-level sidebars that replace the HomeSidebar when
 * navigating into a specific page (e.g. Dev Record, Settings).
 *
 * Renders inside the same SidebarBase glass/resize shell as HomeSidebar:
 * - Back affordance as the first regular list row
 * - Scrollable list of icon + label items with active highlight
 */
import { ChevronLeft, type LucideIcon } from "lucide-react";
import React, { useCallback, useMemo } from "react";

import SidebarBase from "../SidebarBase";
import { SidebarHeaderNavButton, SidebarList } from "../blocks";
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
      <SidebarList>
        <div className="flex flex-col gap-1">
          <SidebarHeaderNavButton
            icon={ChevronLeft}
            label={backLabel}
            onClick={onBack}
          />
          <NavigationMenu
            items={menuItems}
            selectedKeys={selectedKeys}
            onMenuItemClick={handleMenuItemClick}
          />
        </div>
      </SidebarList>
    </SidebarBase>
  );
};

export default PageLevelSidebar;
