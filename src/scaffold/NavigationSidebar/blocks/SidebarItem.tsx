/**
 * SidebarItem
 *
 * Single item component for sidebar lists.
 * Styled to match NavigationMenu for consistency.
 */
import { Pin, PinOff, X } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { LIQUID_GLASS_HOVER } from "@src/components/LiquidGlass/hoverConfig";
import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import type { SidebarItemProps } from "../types";
import { renderSidebarIcon } from "../utils/renderIcon";

// ============================================
// SidebarItem Component
// ============================================

const SidebarItem: React.FC<SidebarItemProps> = ({
  item,
  isActive = false,
  onClick,
  onClose,
  onPin,
  isPinned = false,
  canClose = true,
  canPin = false,
  theme,
  className = "",
}) => {
  const { isDark } = useCurrentTheme();
  const { t } = useTranslation();

  const handleClick = () => {
    onClick?.();
  };

  // Check if this is a private browser tab
  const isPrivateTab = Boolean(item.metadata?.isPrivate);

  // Theme-aware styles
  const textStyle = useMemo(() => {
    if (!theme) return undefined;
    return {
      color: isActive ? theme.foreground : `${theme.foreground}80`,
    };
  }, [theme, isActive]);

  // Icon classes - use text-1 for selected (not blue), warning for private
  const iconClasses = theme
    ? ""
    : isActive
      ? isPrivateTab
        ? "text-warning-6"
        : "text-text-1"
      : "text-text-1";

  // Text classes - use text-1 with medium weight for selected (not blue)
  const textClasses = theme
    ? ""
    : isActive
      ? isPrivateTab
        ? "font-medium text-warning-6"
        : "font-medium text-text-1"
      : "text-text-1";

  // Active state classes - text color only, bg handled via inline style
  const activeTextClasses = isActive
    ? isPrivateTab
      ? "text-warning-6"
      : "text-text-1"
    : "text-text-1";

  // Use same glass hover background for selected state (matches hover)
  const activeBackground = isActive
    ? isDark
      ? LIQUID_GLASS_HOVER.dark
      : LIQUID_GLASS_HOVER.light
    : undefined;

  return (
    <LiquidGlassHoverItem
      className={`group flex h-[36px] items-center justify-between rounded-lg px-2 ${activeTextClasses} ${className}`}
      hoverEnabled={!isActive && !theme}
      onClick={handleClick}
      style={activeBackground ? { background: activeBackground } : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {/* Icon or Favicon */}
        {(item.icon || (item.metadata?.favicon as string)) && (
          <div className={`flex-shrink-0 ${iconClasses}`} style={textStyle}>
            {renderSidebarIcon(item.icon, {
              faviconUrl: item.metadata?.favicon as string | undefined,
              isLoading: item.metadata?.isLoading as boolean | undefined,
            })}
          </div>
        )}

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span
            className={`block truncate text-[13px] ${textClasses}`}
            style={textStyle}
          >
            {item.name}
          </span>
          {item.subtitle && (
            <span
              className="block truncate text-[11px] text-text-3"
              style={theme ? { color: `${theme.foreground}60` } : undefined}
            >
              {item.subtitle}
            </span>
          )}
        </div>
      </div>

      {/* Right side content - positioned to the right end */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {/* Badge */}
        {item.badge && (
          <span className="rounded-full bg-danger-6 px-2 py-0.5 text-[10px] font-medium text-white">
            {item.badge}
          </span>
        )}

        {/* Container for shortcut and actions - they occupy the same space */}
        <div className="relative flex min-w-[40px] items-center justify-end">
          {/* Shortcut - hide on hover */}
          {item.shortcut && (
            <span className="absolute right-0 whitespace-nowrap text-[11px] text-text-3 transition-opacity duration-150 group-hover:opacity-0">
              {item.shortcut}
            </span>
          )}

          {/* Actions - show on hover, positioned absolutely in same space as shortcut */}
          {(item.actions || canPin || canClose) && (
            <div className="absolute right-0 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {/* Custom actions from item.actions */}
              {item.actions && (
                <div className="flex items-center gap-1">{item.actions}</div>
              )}

              {/* Pin button */}
              {canPin && onPin && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onPin();
                  }}
                  className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-fill-2 ${
                    isPinned ? "text-primary-6" : "text-text-3"
                  }`}
                  title={isPinned ? t("actions.remove") : t("actions.add")}
                >
                  {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
              )}

              {/* Close button */}
              {canClose && onClose && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onClose(event);
                  }}
                  onPointerDown={(event) => {
                    // Prevent any interference with pointer events
                    event.stopPropagation();
                  }}
                  className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full text-text-3 transition-all hover:bg-red-500/20 hover:text-red-500"
                  style={theme ? { color: `${theme.foreground}80` } : undefined}
                  title={t("actions.close")}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </LiquidGlassHoverItem>
  );
};

export default React.memo(SidebarItem);
