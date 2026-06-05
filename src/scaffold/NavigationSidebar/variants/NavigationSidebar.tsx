/**
 * NavigationSidebar
 *
 * Main navigation sidebar with tabs and menu items.
 * Used for: Home page, Config page navigation
 */
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import TabPill from "@src/components/TabPill";

import SidebarBase from "../SidebarBase";
import { SidebarList } from "../blocks";
import HoverAnimatedIcon from "../components/HoverAnimatedIcon";
import NavigationMenu from "../components/NavigationMenu";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import type { SidebarTab } from "../types";

// ============================================
// Types
// ============================================

export interface NavigationSidebarProps {
  items: SidebarTab[];
  activeKey: string;
  onChange: (key: string) => void;
  menuItems: NavigationMenuItem[];
  pinnedMenuItems?: NavigationMenuItem[];
  selectedKey?: string;
  onMenuItemClick?: (key: string, item: NavigationMenuItem) => void;
  onMenuItemContextMenu?: (
    e: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  renderMenuItemWrapper?: (
    item: NavigationMenuItem,
    node: React.ReactElement
  ) => React.ReactElement;
  defaultOpenKeys?: string[];
  bottomContent?: React.ReactNode;
  enableHoverIconAnimation?: boolean;
  /** Add-new button in the traffic lights area (passed to SidebarBase) */
  onAddNew?: () => void;
  /** Icon for the add-new button */
  addIcon?: LucideIcon;
  /** Tooltip for the add-new button */
  addLabel?: string;
  /** Optional rich tooltip content for the add-new button */
  addTooltipContent?: React.ReactNode;
  /** Extra controls rendered before add-new (passed to SidebarBase) */
  beforeAddNewActions?: React.ReactNode;
  /** Extra controls next to add-new (passed to SidebarBase) */
  headerActions?: React.ReactNode;
  /** Preserve top padding for the scrollable menu list. */
  listTopPadding?: boolean;
  /** Show loading placeholder instead of menu items */
  isLoading?: boolean;
  /** Enable collapse/expand on section headers (separator-based groups) */
  collapsibleSections?: boolean;
  /**
   * Optional controlled value for the collapsed-section set. When provided
   * together with `onCollapsedSectionsChange`, the parent fully owns the
   * collapse state (e.g. to expose a "Collapse All" action). When omitted,
   * the sidebar manages its own local state.
   */
  collapsedSectionIds?: Set<string>;
  onCollapsedSectionsChange?: (next: Set<string>) => void;
}

// ============================================
// Component
// ============================================

const NavigationSidebar: React.FC<NavigationSidebarProps> = React.memo(
  ({
    items,
    activeKey,
    onChange,
    menuItems,
    pinnedMenuItems = [],
    selectedKey,
    onMenuItemClick,
    onMenuItemContextMenu,
    renderMenuItemWrapper,
    defaultOpenKeys = [],
    bottomContent,
    enableHoverIconAnimation = false,
    onAddNew,
    addIcon,
    addLabel,
    addTooltipContent,
    beforeAddNewActions,
    headerActions,
    listTopPadding = false,
    isLoading = false,
    collapsibleSections = false,
    collapsedSectionIds,
    onCollapsedSectionsChange,
  }) => {
    // Memoize section grouping — only recompute when menuItems changes
    // Separator items (id starts with "separator-") split the list into sections.
    // If a separator has a non-empty label, it becomes the section title.
    const sections = useMemo(() => {
      const result: {
        id: string;
        title?: string;
        items: NavigationMenuItem[];
      }[] = [];
      let currentSection: NavigationMenuItem[] = [];
      let currentTitle: string | undefined;
      let currentId = "default";

      menuItems.forEach((item) => {
        if (item.id?.startsWith("separator-")) {
          if (currentSection.length > 0) {
            result.push({
              id: currentId,
              title: currentTitle,
              items: currentSection,
            });
            currentSection = [];
          }
          currentId = item.id.replace("separator-", "");
          currentTitle = item.label || undefined;
        } else {
          currentSection.push(item);
        }
      });

      if (currentSection.length > 0) {
        result.push({
          id: currentId,
          title: currentTitle,
          items: currentSection,
        });
      }

      return result;
    }, [menuItems]);

    const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<
      Set<string>
    >(new Set());

    const isControlled = collapsedSectionIds !== undefined;
    const collapsedSections = isControlled
      ? collapsedSectionIds
      : uncontrolledCollapsed;

    const toggleSection = useCallback(
      (sectionId: string) => {
        const next = new Set(collapsedSections);
        if (next.has(sectionId)) {
          next.delete(sectionId);
        } else {
          next.add(sectionId);
        }
        if (isControlled) {
          onCollapsedSectionsChange?.(next);
        } else {
          setUncontrolledCollapsed(next);
        }
      },
      [collapsedSections, isControlled, onCollapsedSectionsChange]
    );

    // Stable selected keys array
    const selectedKeys = useMemo(
      () => (selectedKey ? [selectedKey] : []),
      [selectedKey]
    );

    const resolvedDefaultOpenKeys = useMemo(() => {
      if (defaultOpenKeys.length > 0) return defaultOpenKeys;
      return sections.flatMap((section) =>
        section.items.flatMap((item) =>
          item.children && item.children.length > 0 ? [item.key] : []
        )
      );
    }, [defaultOpenKeys, sections]);

    // Stable handler refs — avoid inline arrow wrappers
    const handleMenuItemClick = useCallback(
      (key: string, item: NavigationMenuItem) => {
        onMenuItemClick?.(key, item);
      },
      [onMenuItemClick]
    );

    const handleMenuItemContextMenu = useCallback(
      (e: React.MouseEvent, key: string, item: NavigationMenuItem) => {
        onMenuItemContextMenu?.(e, key, item);
      },
      [onMenuItemContextMenu]
    );

    // Memoize TabPill tabs array
    const tabPillTabs = useMemo(
      () =>
        items.map((tab) => ({
          key: tab.key,
          label: tab.label,
          icon:
            tab.icon && typeof tab.icon !== "string"
              ? enableHoverIconAnimation && tab.iconName
                ? React.createElement(HoverAnimatedIcon, {
                    icon: tab.icon,
                    iconName: tab.iconName,
                    className: "h-[14px] w-[14px]",
                    strokeWidth: 2,
                  })
                : React.createElement(tab.icon, {
                    className: "h-[14px] w-[14px]",
                    strokeWidth: 2,
                  })
              : undefined,
        })),
      [enableHoverIconAnimation, items]
    );

    return (
      <SidebarBase
        onAddNew={onAddNew}
        addIcon={addIcon}
        addLabel={addLabel}
        addTooltipContent={addTooltipContent}
        beforeAddNewActions={beforeAddNewActions}
        headerActions={headerActions}
      >
        {/* Tab Header */}
        {items.length > 0 && (
          <div
            className="flex h-9 items-center px-3"
            data-tauri-drag-region
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div
              className="flex w-full min-w-0"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <TabPill
                activeTab={activeKey}
                region="sidebar"
                tabs={tabPillTabs}
                onChange={onChange}
              />
            </div>
          </div>
        )}

        {pinnedMenuItems.length > 0 && (
          <div className="px-3 pt-1">
            <NavigationMenu
              items={pinnedMenuItems}
              selectedKeys={selectedKeys}
              collapsed={false}
              defaultOpenKeys={resolvedDefaultOpenKeys}
              enableHoverIconAnimation={enableHoverIconAnimation}
              onMenuItemClick={handleMenuItemClick}
              onMenuItemContextMenu={handleMenuItemContextMenu}
              renderMenuItemWrapper={renderMenuItemWrapper}
            />
          </div>
        )}

        {/* Section Container */}
        <SidebarList isLoading={isLoading} topPadding={listTopPadding}>
          {sections.map((section) => {
            const isSectionCollapsed =
              collapsibleSections && collapsedSections.has(section.id);

            return (
              <div key={section.id}>
                {section.title &&
                  (collapsibleSections ? (
                    <div
                      className={`${isSectionCollapsed ? "" : "mb-px"} flex h-7 cursor-pointer items-center gap-3 px-2`}
                      onClick={() => toggleSection(section.id)}
                    >
                      <span className="inline-flex flex-shrink-0 items-center leading-none text-text-2">
                        {isSectionCollapsed ? (
                          <ChevronRight size={14} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={14} strokeWidth={2} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-text-1">
                        {section.title}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-text-1">
                      {section.title}
                    </div>
                  ))}
                {!isSectionCollapsed && (
                  <NavigationMenu
                    items={section.items}
                    selectedKeys={selectedKeys}
                    collapsed={false}
                    defaultOpenKeys={resolvedDefaultOpenKeys}
                    enableHoverIconAnimation={enableHoverIconAnimation}
                    onMenuItemClick={handleMenuItemClick}
                    onMenuItemContextMenu={handleMenuItemContextMenu}
                    renderMenuItemWrapper={renderMenuItemWrapper}
                  />
                )}
              </div>
            );
          })}
        </SidebarList>

        {/* Bottom Content */}
        {bottomContent}
      </SidebarBase>
    );
  }
);

NavigationSidebar.displayName = "NavigationSidebar";

export default NavigationSidebar;
