import { ChevronDown, ChevronRight } from "lucide-react";
import React from "react";

import type { NavigationMenuItem } from "../config";
import { NavigationMenuRowAccessorySlot } from "./RowAccessorySlot";
import { NavigationMenuRowActionButton } from "./RowActionButton";
import type {
  NavigationMenuIconRenderer,
  NavigationMenuItemRenderer,
  NavigationMenuRowActionClickHandler,
  NavigationMenuRowMouseEnterHandler,
} from "./types";

interface NavigationMenuParentRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  item: NavigationMenuItem;
  isChild: boolean;
  isOpen: boolean;
  submenuSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  renderIcon: NavigationMenuIconRenderer;
  renderMenuItem: NavigationMenuItemRenderer;
  onMenuItemClick: (key: string, item: NavigationMenuItem) => void;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowMouseEnter: NavigationMenuRowMouseEnterHandler;
  onToggleSubmenu: (key: string) => void;
}

export const NavigationMenuParentRow = React.forwardRef<
  HTMLDivElement,
  NavigationMenuParentRowProps
>(function NavigationMenuParentRow(
  {
    item,
    isChild,
    isOpen,
    submenuSelected,
    collapsed,
    t,
    renderIcon,
    renderMenuItem,
    onMenuItemClick,
    onMenuItemContextMenu,
    onRowMouseEnter,
    onToggleSubmenu,
    onMouseEnter,
    onMouseLeave,
    ...rootProps
  },
  ref
): React.ReactElement {
  const iconColor = submenuSelected ? "text-primary-6" : "text-text-1";

  return (
    <div
      {...rootProps}
      ref={ref}
      className={`mb-1 ${rootProps.className ?? ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
          onRowMouseEnter(event, item.routePath)
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {renderIcon(item.icon, item.iconName, iconColor, item.iconElement)}
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col gap-0">
              <span
                className={`truncate text-[13px] ${
                  submenuSelected ? "font-medium text-primary-6" : "text-text-1"
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
              aria-label={isOpen ? t("actions.collapse") : t("actions.expand")}
              title={isOpen ? t("actions.collapse") : t("actions.expand")}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-3 transition-colors duration-150 hover:bg-fill-2 hover:text-text-1 focus:outline-none"
              data-testid={`${item.key}-session-tree-toggle`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleSubmenu(item.key);
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
          {item.children.map((child) => (
            <React.Fragment key={child.key}>
              {renderMenuItem(child, true)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
});

interface NavigationMenuLeafRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  item: NavigationMenuItem;
  isChild: boolean;
  isSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  renderIcon: NavigationMenuIconRenderer;
  onMenuItemClick: (key: string, item: NavigationMenuItem) => void;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowMouseEnter: NavigationMenuRowMouseEnterHandler;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

export const NavigationMenuLeafRow = React.forwardRef<
  HTMLDivElement,
  NavigationMenuLeafRowProps
>(function NavigationMenuLeafRow(
  {
    item,
    isChild,
    isSelected,
    collapsed,
    t,
    renderIcon,
    onMenuItemClick,
    onMenuItemContextMenu,
    onRowMouseEnter,
    onRowActionClick,
    onMouseEnter,
    onMouseLeave,
    ...rootProps
  },
  ref
): React.ReactElement {
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

  return (
    <div
      {...rootProps}
      ref={ref}
      className={rootProps.className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={(event: React.MouseEvent) =>
        onMenuItemContextMenu?.(event, item.key, item)
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
        onMouseEnter={(event: React.MouseEvent) =>
          onRowMouseEnter(event, item.routePath)
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {renderIcon(item.icon, item.iconName, iconColor, item.iconElement)}
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
        {renderLeafRowAccessory({
          item,
          isSelected,
          collapsed,
          t,
          onMenuItemContextMenu,
          onRowActionClick,
        })}
      </div>
    </div>
  );
});

interface RenderLeafRowAccessoryArgs {
  item: NavigationMenuItem;
  isSelected: boolean;
  collapsed: boolean;
  t: (key: string) => string;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

function renderLeafRowAccessory({
  item,
  isSelected,
  collapsed,
  t,
  onMenuItemContextMenu,
  onRowActionClick,
}: RenderLeafRowAccessoryArgs): React.ReactNode {
  if (collapsed) return null;

  if (item.showMoreActions) {
    return (
      <NavigationMenuRowAccessorySlot
        workingIndicatorContent={item.workingIndicator}
        persistentContent={item.trailingElement}
        hoverContent={
          item.shortcut ? (
            <span className="max-w-[4rem] truncate text-[11px] text-text-2">
              {item.shortcut}
            </span>
          ) : undefined
        }
        actionContent={renderRowActions({
          item,
          t,
          onMenuItemContextMenu,
          onRowActionClick,
        })}
      />
    );
  }

  if (
    !item.shortcut &&
    !item.trailingElement &&
    !item.workingIndicator &&
    !item.showDrillDownIndicator
  ) {
    return null;
  }

  return (
    <NavigationMenuRowAccessorySlot
      workingIndicatorContent={item.workingIndicator}
      persistentContent={
        <>
          {item.trailingElement}
          {item.showDrillDownIndicator && (
            <ChevronRight
              size={13}
              strokeWidth={2}
              className={isSelected ? "text-primary-6" : "text-text-3"}
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
  );
}

interface RenderRowActionsArgs {
  item: NavigationMenuItem;
  t: (key: string) => string;
  onMenuItemContextMenu?: (
    event: React.MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => void;
  onRowActionClick: NavigationMenuRowActionClickHandler;
}

function renderRowActions({
  item,
  t,
  onMenuItemContextMenu,
  onRowActionClick,
}: RenderRowActionsArgs): React.ReactNode {
  if (item.rowActions?.length) {
    return item.rowActions.map((action, actionIndex) => (
      <NavigationMenuRowActionButton
        key={`${action.label}:${actionIndex}`}
        icon={action.icon}
        label={action.label}
        active={action.active}
        onClick={action.onClick}
      />
    ));
  }

  if (!onMenuItemContextMenu && !item.onRowActionClick) return undefined;

  return (
    <NavigationMenuRowActionButton
      icon={item.rowActionIcon}
      label={item.rowActionLabel ?? t("actions.more")}
      onClick={(event) => onRowActionClick(event, item)}
    />
  );
}
