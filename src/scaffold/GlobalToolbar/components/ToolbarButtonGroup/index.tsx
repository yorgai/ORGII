/**
 * ToolbarButtonGroup Component
 *
 * A liquid glass container for toolbar icon button groups.
 * Exclusively used by GlobalToolbar for action groups with 1-6 buttons.
 *
 * Features:
 * - Liquid glass thin material container
 * - Height: 36px with horizontal padding only
 * - Border radius: 100px (fully rounded)
 * - Each button: 28x28 with 14px icons, hover/selected states
 * - No color on default state, only hover/selected
 * - Adaptive text colors based on background luminance
 */
import { useAtomValue } from "jotai";
import { LucideIcon } from "lucide-react";
import React, { useEffect, useState } from "react";

import { LIQUID_GLASS_PRESSED } from "@src/components/LiquidGlass/hoverConfig";
import Tooltip from "@src/components/Tooltip";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { backgroundImageAtom } from "@src/store";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import ToolbarGlassContainer from "../ToolbarGlassContainer";

// ============================================
// Types
// ============================================

export interface ToolbarButtonGroupItem {
  /** Unique identifier for the button */
  id: string;
  /** Fully custom button element. When set, icon/onClick/title fields are ignored. */
  element?: React.ReactNode;
  /** Lucide icon component (use this OR iconElement, not both) */
  icon?: LucideIcon;
  /** Pre-rendered icon element for custom SVGs (use this OR icon, not both) */
  iconElement?: React.ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Tooltip text */
  title?: string;
  /** Custom tooltip content. When set, native title is disabled. */
  tooltipContent?: React.ReactNode;
  /** Whether this button is currently selected/active */
  selected?: boolean;
  /** CSS class to apply to the icon element (e.g. spin animation) */
  iconClassName?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
}

export interface ToolbarButtonGroupProps {
  /** Array of 1-6 button items */
  items: ToolbarButtonGroupItem[];
  /** Additional className for the container */
  className?: string;
}

// ============================================
// Icon Button Component (Transparent by default)
// ============================================

interface IconButtonProps {
  icon?: LucideIcon;
  iconElement?: React.ReactNode;
  onClick: () => void;
  title?: string;
  tooltipContent?: React.ReactNode;
  selected?: boolean;
  iconClassName?: string;
  disabled?: boolean;
  /** Adaptive text color from parent */
  adaptiveTextColor?: string;
  /** Stable test id (mirrors the group item's id, e.g. "add") */
  testId?: string;
}

const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon,
  iconElement,
  onClick,
  title,
  tooltipContent,
  selected,
  iconClassName,
  disabled,
  adaptiveTextColor,
  testId,
}) => {
  const [ref, isHovered] = useSafeHover<HTMLButtonElement>({ disabled });
  const [isPressed, setIsPressed] = useState(false);
  useEffect(() => () => setIsPressed(false), []);
  const { isDark } = useCurrentTheme();

  const textColor = adaptiveTextColor ?? "var(--color-text-1)";

  const button = (
    <button
      ref={ref}
      data-testid={testId ? `toolbar-button-${testId}` : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltipContent ? undefined : title}
      onMouseLeave={() => setIsPressed(false)}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      style={{
        position: "relative",
        width: "28px",
        height: "28px",
        borderRadius: "100px",
        border: "none",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: textColor,
        transition: "color 0.2s ease",
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* Hover/selected overlay */}
      {(selected || isHovered) && !isPressed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "100px",
            background: "var(--color-fill-2)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      {/* Pressed overlay - distinct color for click feedback */}
      {isPressed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "100px",
            background: isDark
              ? LIQUID_GLASS_PRESSED.dark
              : LIQUID_GLASS_PRESSED.light,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      {/* Icon content */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {iconElement ??
          (Icon ? (
            <Icon size={14} strokeWidth={1.75} className={iconClassName} />
          ) : null)}
      </div>
    </button>
  );

  if (!tooltipContent) return button;

  return (
    <Tooltip
      content={tooltipContent}
      position="bottom-end"
      mouseEnterDelay={200}
      framedPanel
    >
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
};

// ============================================
// Component
// ============================================

export const ToolbarButtonGroup: React.FC<ToolbarButtonGroupProps> = ({
  items,
  className = "",
}) => {
  // Adaptive colors based on background luminance
  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;

  // Text color: use adaptive color when enabled, otherwise undefined (IconButton uses CSS var)
  const adaptiveTextColor = adaptiveEnabled
    ? toolbarLuminance.textColor
    : undefined;

  if (items.length < 1 || items.length > 6) {
    console.warn(
      `ToolbarButtonGroup: Expected 1-6 items, received ${items.length}. Component may not render optimally.`
    );
  }

  return (
    <ToolbarGlassContainer chrome="buttonGroup" className={className}>
      {items.map((item) =>
        item.element ? (
          <React.Fragment key={item.id}>{item.element}</React.Fragment>
        ) : (
          <IconButton
            key={item.id}
            testId={item.id}
            icon={item.icon}
            iconElement={item.iconElement}
            onClick={item.onClick}
            title={item.title}
            tooltipContent={item.tooltipContent}
            selected={item.selected}
            iconClassName={item.iconClassName}
            disabled={item.disabled}
            adaptiveTextColor={adaptiveTextColor}
          />
        )
      )}
    </ToolbarGlassContainer>
  );
};

export default ToolbarButtonGroup;
