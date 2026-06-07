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

import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../../HoverAnimatedIcon";
import type { NavigationMenuItem } from "../config";

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
}

// ============================================
// NavigationMenu Component
// ============================================
interface NavigationMenuRowActionButtonProps {
  icon?: NavigationMenuItem["rowActionIcon"];
  label: string;
  active?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

function NavigationMenuRowActionButton({
  icon,
  label,
  active = false,
  onClick,
}: NavigationMenuRowActionButtonProps): React.ReactElement {
  const RowActionIcon = icon ?? MoreHorizontal;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors duration-150 hover:bg-fill-2 hover:text-text-1 focus:outline-none ${
        active ? "text-primary-6" : "text-text-3"
      }`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
    >
      {React.createElement(RowActionIcon, {
        size: 14,
        strokeWidth: icon ? 2 : 1.75,
      })}
    </button>
  );
}

interface NavigationMenuRowAccessorySlotProps {
  persistentContent?: React.ReactNode;
  hoverContent?: React.ReactNode;
  actionContent?: React.ReactNode;
}

function NavigationMenuRowAccessorySlot({
  persistentContent,
  hoverContent,
  actionContent,
}: NavigationMenuRowAccessorySlotProps): React.ReactElement | null {
  if (!persistentContent && !hoverContent && !actionContent) return null;

  return (
    <span className="ml-1 grid flex-shrink-0 items-center justify-end leading-none">
      {persistentContent && (
        <span className="col-start-1 row-start-1 inline-flex items-center justify-end leading-none transition-opacity duration-150 group-hover:pointer-events-none group-hover:opacity-0">
          {persistentContent}
        </span>
      )}
      {(hoverContent || actionContent) && (
        <span className="pointer-events-none col-start-1 row-start-1 inline-flex max-w-0 items-center justify-end gap-1.5 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-150 group-hover:pointer-events-auto group-hover:max-w-[11rem] group-hover:opacity-100">
          {hoverContent && (
            <span className="inline-flex max-w-[4rem] items-center justify-end overflow-hidden">
              {hoverContent}
            </span>
          )}
          {actionContent && (
            <span className="inline-flex items-center justify-end gap-1">
              {actionContent}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

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
  }) => {
    const { t } = useTranslation();

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
            onContextMenu={(e: React.MouseEvent) =>
              onMenuItemContextMenu?.(e, item.key, item)
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
              onClick={(event: React.MouseEvent) => {
                if (item.disabled) return;
                if (isSelected && onMenuItemContextMenu) {
                  onMenuItemContextMenu(event, item.key, item);
                  return;
                }
                onMenuItemClick(item.key, item);
              }}
              onMouseEnter={(e: React.MouseEvent) =>
                handleRowMouseEnter(e, item.routePath)
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
                <NavigationMenuRowAccessorySlot
                  persistentContent={item.trailingElement}
                  hoverContent={
                    item.shortcut ? (
                      <span className="max-w-[4rem] truncate text-[11px] text-text-2">
                        {item.shortcut}
                      </span>
                    ) : undefined
                  }
                  actionContent={
                    item.rowActions?.length ? (
                      item.rowActions.map((action) => (
                        <NavigationMenuRowActionButton
                          key={action.label}
                          icon={action.icon}
                          label={action.label}
                          active={action.active}
                          onClick={action.onClick}
                        />
                      ))
                    ) : onMenuItemContextMenu || item.onRowActionClick ? (
                      <NavigationMenuRowActionButton
                        icon={item.rowActionIcon}
                        label={item.rowActionLabel ?? t("actions.more")}
                        onClick={(event) => handleRowActionClick(event, item)}
                      />
                    ) : undefined
                  }
                />
              ) : (
                !collapsed &&
                (item.shortcut ||
                  item.trailingElement ||
                  item.showDrillDownIndicator) && (
                  <NavigationMenuRowAccessorySlot
                    persistentContent={
                      <>
                        {item.trailingElement}
                        {item.showDrillDownIndicator && (
                          <ChevronRight
                            size={13}
                            strokeWidth={2}
                            className={
                              isSelected ? "text-primary-6" : "text-text-3"
                            }
                          />
                        )}
                      </>
                    }
                    hoverContent={
                      item.shortcut ? (
                        <span className="max-w-[4.5rem] truncate text-[11px] text-text-3">
                          {item.shortcut}
                        </span>
                      ) : undefined
                    }
                  />
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
      <div className="flex flex-col gap-1">
        {items.map((item) => renderMenuItem(item))}
      </div>
    );
  }
);

NavigationMenu.displayName = "NavigationMenu";

export default NavigationMenu;
