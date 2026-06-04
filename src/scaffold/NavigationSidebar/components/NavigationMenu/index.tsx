import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { preloadRouteByPath } from "@src/router/lazy/preload";

import HoverAnimatedIcon, { triggerIconAnimation } from "../HoverAnimatedIcon";
import type { NavigationMenuItem } from "./config";

// ============================================
// NavigationMenu Props
// ============================================
export interface NavigationMenuProps {
  items: NavigationMenuItem[];
  selectedKeys: string[];
  onMenuItemClick: (key: string, item: NavigationMenuItem) => void;
  onMenuItemContextMenu?: (
    e: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  renderMenuItemWrapper?: (
    item: NavigationMenuItem,
    node: React.ReactElement
  ) => React.ReactElement;
  collapsed?: boolean;
  defaultOpenKeys?: string[];
  enableHoverIconAnimation?: boolean;
  // Tailwind gap class for the vertical list container.
  // Defaults to "gap-1"; Settings and Session sidebars opt into "gap-px".
  verticalGapClassName?: string;
}

// ============================================
// NavigationMenu Component
// ============================================
const NavigationMenu: React.FC<NavigationMenuProps> = React.memo(
  ({
    items,
    selectedKeys,
    onMenuItemClick,
    onMenuItemContextMenu,
    renderMenuItemWrapper,
    collapsed = false,
    defaultOpenKeys = [],
    enableHoverIconAnimation = false,
    verticalGapClassName = "gap-1",
  }) => {
    const { t } = useTranslation();

    const rowHoverBackground = "var(--color-fill-2)";

    const itemsKey = useMemo(
      () => items.map((item) => item.key).join(","),
      [items]
    );
    const defaultOpenKeysKey = useMemo(
      () => defaultOpenKeys.join(","),
      [defaultOpenKeys]
    );
    const selectedKeysKey = useMemo(
      () => selectedKeys.join(","),
      [selectedKeys]
    );

    const [openSubmenus, setOpenSubmenus] = useState<string[]>(defaultOpenKeys);

    const toggleSubmenu = useCallback((key: string) => {
      setOpenSubmenus((prev) =>
        prev.includes(key)
          ? prev.filter((keyItem) => keyItem !== key)
          : [...prev, key]
      );
    }, []);

    const isSubmenuSelected = useCallback(
      (item: NavigationMenuItem): boolean => {
        if (!item.children) return false;
        return item.children.some((child) => selectedKeys.includes(child.key));
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [selectedKeysKey]
    );

    const prevKeysRef = useRef({ itemsKey: "", defaultOpenKeysKey: "" });

    useEffect(() => {
      const keysChanged =
        prevKeysRef.current.itemsKey !== itemsKey ||
        prevKeysRef.current.defaultOpenKeysKey !== defaultOpenKeysKey;

      if (keysChanged) {
        prevKeysRef.current = { itemsKey, defaultOpenKeysKey };
        setOpenSubmenus(defaultOpenKeys);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsKey, defaultOpenKeysKey]);

    useEffect(() => {
      items.forEach((item) => {
        if (item.children && isSubmenuSelected(item)) {
          setOpenSubmenus((prev) =>
            prev.includes(item.key) ? prev : [...prev, item.key]
          );
        }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsKey, selectedKeysKey]);

    const renderIcon = useCallback(
      (
        icon: NavigationMenuItem["icon"],
        iconName: string | undefined,
        colorClass: string,
        iconElement?: NavigationMenuItem["iconElement"]
      ) => {
        if (iconElement) {
          return (
            <span
              className={`inline-flex flex-shrink-0 items-center leading-none ${colorClass}`}
            >
              {iconElement}
            </span>
          );
        }

        if (!icon) return null;

        if (typeof icon === "string") {
          return (
            <i className={`${icon} flex-shrink-0 text-[14px] ${colorClass}`} />
          );
        }

        if (enableHoverIconAnimation) {
          return (
            <HoverAnimatedIcon
              icon={icon}
              iconName={iconName}
              size={14}
              strokeWidth={2}
              className={`flex-shrink-0 ${colorClass}`}
            />
          );
        }

        return React.createElement(icon, {
          size: 14,
          strokeWidth: 2,
          className: `flex-shrink-0 ${colorClass}`,
        });
      },
      [enableHoverIconAnimation]
    );

    const handleRowMouseEnter = useCallback(
      (e: React.MouseEvent, routePath?: string) => {
        if (enableHoverIconAnimation) {
          triggerIconAnimation(e.currentTarget as HTMLElement);
        }
        if (routePath) {
          preloadRouteByPath(routePath);
        }
      },
      [enableHoverIconAnimation]
    );

    const handleRowActionClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>, item: NavigationMenuItem) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.onRowActionClick) {
          item.onRowActionClick(e);
          return;
        }
        onMenuItemContextMenu?.(e, item.key, item);
      },
      [onMenuItemContextMenu]
    );

    const renderMenuItem = useCallback(
      (item: NavigationMenuItem, isChild = false) => {
        const hasChildren = item.children && item.children.length > 0;
        const isSelected = selectedKeys.includes(item.key);
        const isOpen = openSubmenus.includes(item.key);
        const submenuSelected = hasChildren && isSubmenuSelected(item);

        if (hasChildren) {
          const iconColor = submenuSelected ? "text-primary-6" : "text-text-1";
          const parentNode = (
            <div
              key={item.key}
              className="mb-1"
              onContextMenu={
                onMenuItemContextMenu
                  ? (event: React.MouseEvent) =>
                      onMenuItemContextMenu(event, item.key, item)
                  : undefined
              }
            >
              <div
                data-testid={item.dataTestId}
                className={`group flex min-h-[36px] cursor-pointer items-center justify-between rounded-lg transition-colors duration-150 ${
                  isChild ? "pl-5 pr-2" : "px-2"
                } ${submenuSelected ? "bg-bg-2 text-primary-6" : "text-text-1 hover:bg-fill-2"}`}
                onClick={() => {
                  if (!item.disabled) onMenuItemClick(item.key, item);
                }}
                onMouseEnter={(event: React.MouseEvent) =>
                  handleRowMouseEnter(event, item.routePath)
                }
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {renderIcon(
                    item.icon,
                    item.iconName,
                    iconColor,
                    item.iconElement
                  )}
                  {!collapsed && (
                    <div className="flex min-w-0 flex-1 flex-col gap-0">
                      <span
                        className={`truncate text-[13px] ${
                          submenuSelected
                            ? "font-medium text-primary-6"
                            : "text-text-1"
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.subtitle && (
                        <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-text-3">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {!collapsed && (
                  <span className="ml-1 inline-flex flex-shrink-0 items-center gap-1.5 leading-none">
                    {item.trailingElement && (
                      <span className="inline-flex flex-shrink-0 items-center leading-none">
                        {item.trailingElement}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={
                        isOpen ? t("actions.collapse") : t("actions.expand")
                      }
                      title={
                        isOpen ? t("actions.collapse") : t("actions.expand")
                      }
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 transition-colors duration-150 hover:bg-fill-2 hover:text-text-1 focus:outline-none"
                      data-testid={`${item.key}-session-tree-toggle`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSubmenu(item.key);
                      }}
                    >
                      <ChevronDown
                        size={12}
                        strokeWidth={2}
                        className={`transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        } ${submenuSelected ? "text-primary-6" : "text-text-2"}`}
                      />
                    </button>
                  </span>
                )}
              </div>

              {isOpen && !collapsed && item.children && (
                <div className="mt-1 space-y-1">
                  {item.children.map((child) => renderMenuItem(child, true))}
                </div>
              )}
            </div>
          );

          return renderMenuItemWrapper
            ? renderMenuItemWrapper(item, parentNode)
            : parentNode;
        }

        const isSecondaryTone = item.visualTone === "secondary";
        const iconColor = item.disabled
          ? isSecondaryTone
            ? "text-text-2"
            : "text-text-3"
          : isSelected
            ? "text-primary-6"
            : isSecondaryTone
              ? "text-text-2"
              : "text-text-1";

        const menuItemNode = (
          <div
            key={item.key}
            onContextMenu={
              onMenuItemContextMenu
                ? (e: React.MouseEvent) =>
                    onMenuItemContextMenu(e, item.key, item)
                : undefined
            }
          >
            <div
              data-testid={item.dataTestId}
              className={`group flex min-h-[36px] items-center justify-between overflow-hidden rounded-lg transition-colors duration-150 ${
                isChild ? "pl-5 pr-2" : "px-2"
              } ${item.subtitle ? "py-1.5" : ""} ${
                item.disabled
                  ? isSecondaryTone
                    ? "cursor-default text-text-2 opacity-60"
                    : "cursor-default text-text-3 opacity-60"
                  : isSelected
                    ? "bg-bg-2 text-primary-6"
                    : isSecondaryTone
                      ? "cursor-pointer text-text-2 hover:bg-fill-2 hover:text-text-1"
                      : "cursor-pointer text-text-1 hover:bg-fill-2"
              }`}
              onClick={() => {
                if (!item.disabled) onMenuItemClick(item.key, item);
              }}
              onMouseEnter={(e: React.MouseEvent) =>
                handleRowMouseEnter(e, item.routePath)
              }
            >
              <div
                className={`flex min-w-0 flex-1 items-center gap-3 transition-[padding] duration-150 ${
                  !collapsed && item.showMoreActions ? "group-hover:pr-7" : ""
                }`}
              >
                {renderIcon(
                  item.icon,
                  item.iconName,
                  iconColor,
                  item.iconElement
                )}
                {!collapsed && (
                  <div className="flex min-w-0 flex-1 flex-col gap-0">
                    <span
                      className={`min-w-0 truncate text-[13px] ${
                        item.disabled
                          ? isSecondaryTone
                            ? "text-text-2"
                            : "text-text-3"
                          : isSelected
                            ? "font-medium text-primary-6"
                            : isSecondaryTone
                              ? "text-text-2"
                              : "text-text-1"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.subtitle && (
                      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-text-3">
                        {item.subtitle}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {!collapsed && item.showMoreActions ? (
                <>
                  {item.trailingElement && (
                    <span className="ml-1 inline-flex flex-shrink-0 items-center leading-none transition-opacity duration-150 group-hover:opacity-0">
                      {item.trailingElement}
                    </span>
                  )}
                  <span
                    className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-16 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    style={{
                      background: `linear-gradient(to left, ${rowHoverBackground} 0%, ${rowHoverBackground} 42%, rgba(255,255,255,0) 100%)`,
                    }}
                    aria-hidden
                  />
                  <span className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                    {item.shortcut && (
                      <span className="max-w-[4rem] truncate text-[11px] text-text-2">
                        {item.shortcut}
                      </span>
                    )}
                    {(onMenuItemContextMenu || item.onRowActionClick) && (
                      <button
                        type="button"
                        aria-label={item.rowActionLabel ?? t("actions.more")}
                        title={item.rowActionLabel ?? t("actions.more")}
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 transition-colors duration-150 hover:bg-fill-2 hover:text-text-1 focus:outline-none"
                        onClick={(e) => handleRowActionClick(e, item)}
                      >
                        {React.createElement(
                          item.rowActionIcon ?? MoreHorizontal,
                          {
                            size: 14,
                            strokeWidth: item.rowActionIcon ? 2 : 1.75,
                          }
                        )}
                      </button>
                    )}
                  </span>
                </>
              ) : (
                !collapsed &&
                (item.shortcut ||
                  item.trailingElement ||
                  item.showDrillDownIndicator) && (
                  <span className="ml-1 inline-flex flex-shrink-0 items-center gap-1.5 leading-none">
                    {item.shortcut && (
                      <span className="max-w-[4.5rem] truncate text-[11px] text-text-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        {item.shortcut}
                      </span>
                    )}
                    {item.trailingElement && (
                      <span className="inline-flex flex-shrink-0 items-center leading-none">
                        {item.trailingElement}
                      </span>
                    )}
                    {item.showDrillDownIndicator && (
                      <ChevronRight
                        size={13}
                        strokeWidth={2}
                        className={
                          isSelected ? "text-primary-6" : "text-text-3"
                        }
                      />
                    )}
                  </span>
                )
              )}
            </div>
          </div>
        );

        return renderMenuItemWrapper
          ? renderMenuItemWrapper(item, menuItemNode)
          : menuItemNode;
      },
      [
        selectedKeys,
        openSubmenus,
        isSubmenuSelected,
        collapsed,
        rowHoverBackground,
        renderMenuItemWrapper,
        renderIcon,
        handleRowMouseEnter,
        toggleSubmenu,
        t,
        handleRowActionClick,
        onMenuItemClick,
        onMenuItemContextMenu,
      ]
    );

    return (
      <div className={`flex flex-col ${verticalGapClassName}`}>
        {items.map((item) => renderMenuItem(item))}
      </div>
    );
  }
);

NavigationMenu.displayName = "NavigationMenu";

export default NavigationMenu;
