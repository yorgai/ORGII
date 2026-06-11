/**
 * SidebarBase
 *
 * The foundational wrapper for all sidebar components.
 * Handles: transparent sidebar surface, resize, collapse, traffic lights spacing.
 *
 * @example
 * ```tsx
 * <SidebarBase sidebarId="terminal">
 *   <SidebarHeader title="Terminal" />
 *   <SidebarList>
 *     <SidebarItem ... />
 *   </SidebarList>
 * </SidebarBase>
 * ```
 */
import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import i18next from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { PanelLeft, Plus, X } from "lucide-react";
import React, { useCallback, useMemo } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import {
  HOST_DESKTOP,
  resolveHostDesktop,
} from "@src/config/windowChromeRadius";
import { useSidebarState } from "@src/hooks/ui/sidebar/useSidebarState";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { getSidebarSurfaceBackgroundStyle } from "@src/modules/shared/layouts/viewContainerTokens";
import { VerticalResizeHandle } from "@src/scaffold/Resize";
import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import { hoverSidebarOpenAtom } from "@src/store/ui/hoverSidebarAtom";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "@src/store/ui/sidebarAtom";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";
import { isTauriDesktop } from "@src/util/platform/tauri";

import { SIDEBAR_STYLE } from "./config";
import { useForceVisibleSidebar } from "./contexts/ForceVisibleContext";
import type { SidebarBaseProps } from "./types";

const PLATFORM_SIDEBAR_RADIUS =
  resolveHostDesktop() === HOST_DESKTOP.MACOS ? SIDEBAR_STYLE.borderRadius : 8;

const IDLE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME =
  "h-full [&>div:first-child]:origin-right [&>div:first-child]:scale-x-50 [&>div:first-child]:transition-transform hover:[&>div:first-child]:scale-x-100";

// ============================================
// SidebarBase Component
// ============================================

const SidebarBase: React.FC<SidebarBaseProps> = React.memo(
  ({
    children,
    header,
    className = "",
    innerClassName = "",
    includeTrafficLightSpace = true,
    showCollapseButton = true,
    wrapInSurface = true,
    forceVisible: forceVisibleProp = false,
    theme,
    onCollapse,
    onAddNew,
    addIcon: AddIcon = Plus,
    addLabel,
    addTooltipContent,
    beforeAddNewActions,
    headerActions,
  }) => {
    const {
      width: sidebarWidth,
      isDragging,
      handleMouseDown,
      isCollapsed,
      collapse,
      expand,
      setWidth,
    } = useSidebarState();

    const isMacOS = isTauriDesktop();
    const hideSidebarShortcut = getShortcutKeys("toggle_sidebar");
    const isFullscreen = useAtomValue(windowFullscreenAtom);
    const isCompactLayout = useIsCompactLayout();
    const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
    const sidebarOpacityStyle = useMemo(
      () => getSidebarSurfaceBackgroundStyle(backgroundConfig.sidebarOpacity),
      [backgroundConfig.sidebarOpacity]
    );

    // Check for force visible from context (for hover sidebar)
    const forceVisibleFromContext = useForceVisibleSidebar();
    const shouldForceVisible = forceVisibleProp || forceVisibleFromContext;

    // Check if hover sidebar is open — split read/write to avoid re-renders from setter reference
    const isHoverSidebarOpen = useAtomValue(hoverSidebarOpenAtom);
    const setIsHoverSidebarOpen = useSetAtom(hoverSidebarOpenAtom);

    // Handle collapse with optional callback
    const handleCollapse = useCallback(() => {
      // If hover sidebar is open, close it instead of collapsing
      if (isHoverSidebarOpen) {
        setIsHoverSidebarOpen(false);
        return;
      }
      collapse();
      onCollapse?.();
    }, [isHoverSidebarOpen, setIsHoverSidebarOpen, collapse, onCollapse]);

    // Handle expand - turn sidebar on permanently and close floating
    const handleExpand = useCallback(() => {
      setIsHoverSidebarOpen(false);
      expand();
    }, [setIsHoverSidebarOpen, expand]);

    const handleResizeContextMenu = useCallback(
      (event: React.MouseEvent) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();

        const isAlreadyDefault = sidebarWidth === DEFAULT_SIDEBAR_WIDTH;
        const isAlreadyMin = sidebarWidth <= MIN_SIDEBAR_WIDTH;

        (async () => {
          try {
            const t = i18next.t.bind(i18next);

            const resizeDefaultItem = await MenuItem.new({
              text: t("tooltips.resizeToDefault", {
                width: DEFAULT_SIDEBAR_WIDTH,
              }),
              enabled: !isAlreadyDefault,
              action: () => {
                setWidth(DEFAULT_SIDEBAR_WIDTH);
              },
            });
            const minimizeItem = await MenuItem.new({
              text: t("tooltips.minimizeWidth", {
                width: MIN_SIDEBAR_WIDTH,
              }),
              enabled: !isAlreadyMin,
              action: () => {
                setWidth(MIN_SIDEBAR_WIDTH);
              },
            });
            const separator = await PredefinedMenuItem.new({
              item: "Separator",
            });
            const hideItem = await MenuItem.new({
              text: t("tooltips.hideSidebar"),
              action: () => {
                collapse();
              },
            });
            const menu = await TauriMenu.new({
              items: [resizeDefaultItem, minimizeItem, separator, hideItem],
            });
            await menu.popup();
          } catch (error) {
            console.error("Failed to show sidebar context menu:", error);
          }
        })();
      },
      [sidebarWidth, setWidth, collapse]
    );

    // Theme-aware styles — memoized to keep stable reference (must be before early return)
    const themeStyles = useMemo(
      () =>
        theme
          ? {
              backgroundColor: theme.background,
              borderColor: theme.border || `${theme.foreground}20`,
            }
          : undefined,
      [theme]
    );

    // Icon color style — memoized for all icon instances
    const iconThemeStyle = useMemo(
      () => (theme ? { color: `${theme.foreground}80` } : undefined),
      [theme]
    );

    // Resolve children (support render function pattern) — memoized
    const resolvedChildren = useMemo(
      () =>
        typeof children === "function" ? children(sidebarWidth) : children,
      [children, sidebarWidth]
    );

    // When forceVisible and collapsed, use default width instead of 0
    const effectiveWidth =
      shouldForceVisible && isCollapsed ? DEFAULT_SIDEBAR_WIDTH : sidebarWidth;

    // Memoize outer container style to avoid re-creating on every render
    const containerStyle = useMemo(
      () => ({
        width: `${effectiveWidth}px`,
        willChange: isDragging ? ("width" as const) : ("auto" as const),
      }),
      [effectiveWidth, isDragging]
    );

    // Don't render if collapsed (unless forceVisible is true)
    if (isCollapsed && !shouldForceVisible) {
      return null;
    }

    // Traffic lights section
    const renderTrafficLightsSpace = () => {
      if (!includeTrafficLightSpace) return null;

      // In fullscreen mode, traffic lights are hidden, so no padding needed
      const trafficLightPadding = isFullscreen
        ? 0
        : SIDEBAR_STYLE.trafficLightsPadding;

      return (
        <div
          className="flex flex-nowrap items-center justify-end gap-1 pr-2"
          data-tauri-drag-region
          style={
            {
              height: `${SIDEBAR_STYLE.topBarHeight}px`,
              paddingLeft: `${trafficLightPadding}px`,
              WebkitAppRegion: "drag",
            } as React.CSSProperties
          }
        >
          {beforeAddNewActions ? (
            <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              {beforeAddNewActions}
            </div>
          ) : null}

          {/* Top action button */}
          {onAddNew && (
            <div
              className="shrink-0"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <Tooltip
                content={
                  addTooltipContent ||
                  addLabel ||
                  i18next.t("navigation:sidebar.actions.addNew")
                }
                position="bottom"
                showArrow={false}
                framedPanel={!!addTooltipContent}
              >
                <div
                  className="h-[28px] w-[28px]"
                  onClick={onAddNew}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onAddNew();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] transition-colors duration-150 hover:bg-fill-2">
                    <AddIcon
                      size={16}
                      strokeWidth={2}
                      className="text-text-2"
                      style={iconThemeStyle}
                    />
                  </div>
                </div>
              </Tooltip>
            </div>
          )}

          {headerActions ? (
            <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              {headerActions}
            </div>
          ) : null}

          {/* Collapse/Expand buttons */}
          <div
            className="flex shrink-0 items-center gap-1"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {isMacOS && showCollapseButton ? (
              isHoverSidebarOpen ? (
                <>
                  {/* Expand sidebar permanently button */}
                  <button
                    type="button"
                    className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
                    onClick={handleExpand}
                  >
                    <PanelLeft
                      size={16}
                      strokeWidth={2}
                      className="text-text-2"
                      style={iconThemeStyle}
                    />
                  </button>
                  {/* Close floating sidebar button */}
                  <button
                    type="button"
                    className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
                    onClick={handleCollapse}
                  >
                    <X
                      size={16}
                      strokeWidth={2}
                      className="text-text-2"
                      style={iconThemeStyle}
                    />
                  </button>
                </>
              ) : (
                <Tooltip
                  content={
                    <KeyboardShortcutTooltipContent
                      label={i18next.t("common:tooltips.hideSidebar")}
                      shortcut={hideSidebarShortcut}
                    />
                  }
                  position="bottom"
                  mouseEnterDelay={200}
                  framedPanel
                >
                  <div className="inline-flex">
                    <button
                      type="button"
                      className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
                      onClick={handleCollapse}
                    >
                      <PanelLeft
                        size={16}
                        strokeWidth={2}
                        className="text-text-2"
                        style={iconThemeStyle}
                      />
                    </button>
                  </div>
                </Tooltip>
              )
            ) : (
              <div className="h-[28px] w-[28px]" />
            )}
          </div>
        </div>
      );
    };

    const renderResizeHandle = () => (
      <div
        className="absolute right-0 top-0 z-50 h-full"
        style={{ pointerEvents: "auto" }}
      >
        <VerticalResizeHandle
          className={IDLE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME}
          isResizing={isDragging}
          onMouseDown={handleMouseDown}
          onContextMenu={handleResizeContextMenu}
          variant={isCompactLayout ? "border" : "transparent"}
        />
      </div>
    );

    // Content
    // Compact layout: the sidebar surface itself reaches the top window edge
    // (no outer `pt-2`), so we move the 8px top breathing room inside via a
    // spacer div. This keeps the header / icons at the same vertical position
    // as inset/full while letting the surface cover the full sidebar column.
    const content = (
      <>
        {isCompactLayout && wrapInSurface && (
          <div
            className="h-2 flex-shrink-0"
            data-tauri-drag-region
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            aria-hidden
          />
        )}
        {renderTrafficLightsSpace()}
        {header}
        <div className="flex flex-1 flex-col overflow-hidden">
          {resolvedChildren}
        </div>
      </>
    );

    // Compact layout: the sidebar is flush with the window edge with no
    // radius, so the floating drop shadow has nothing to "cast" against
    // and just smudges the boundary with the content panel. Drop it.
    const sidebarBoxShadow = isCompactLayout ? "none" : "var(--sidebar-shadow)";
    const surfaceStyle = themeStyles
      ? {
          ...themeStyles,
          boxShadow: sidebarBoxShadow,
          backdropFilter: "var(--sidebar-backdrop)",
          WebkitBackdropFilter: "var(--sidebar-backdrop)",
        }
      : {
          backgroundColor: "var(--sidebar-bg)",
          borderColor: "var(--sidebar-border)",
          boxShadow: sidebarBoxShadow,
          backdropFilter: "var(--sidebar-backdrop)",
          WebkitBackdropFilter: "var(--sidebar-backdrop)",
          ...sidebarOpacityStyle,
        };

    // Wrapped content
    // Compact layout: sidebar is flush with the top/left/bottom window edge —
    // no outer padding, no border radius. The 8px header inset lives inside
    // `content` (see spacer above) so the surface itself reaches the window edge.
    const wrappedContent = wrapInSurface ? (
      <div
        className={`sidebar-base flex h-full w-full flex-col ${
          isCompactLayout ? "" : "pb-2 pl-2 pt-2"
        } ${innerClassName}`}
      >
        <div
          className="flex flex-1 flex-col overflow-hidden border"
          style={{
            ...surfaceStyle,
            borderRadius: isCompactLayout ? 0 : PLATFORM_SIDEBAR_RADIUS,
          }}
        >
          {content}
        </div>
      </div>
    ) : (
      <div
        className={`sidebar-base flex h-full w-full flex-col ${innerClassName}`}
        style={themeStyles}
      >
        {content}
      </div>
    );

    return (
      <div
        className={`relative flex h-full flex-shrink-0 ${
          isDragging ? "" : "transition-[width] duration-150"
        } ${className}`}
        style={containerStyle}
        onContextMenu={handleResizeContextMenu}
      >
        {wrappedContent}
        {renderResizeHandle()}
      </div>
    );
  }
);

SidebarBase.displayName = "SidebarBase";

export default SidebarBase;
