/**
 * ToolbarButton Component
 *
 * A button specifically designed for use inside LiquidGlassToolbar (WebGL-based).
 * Does NOT apply backdrop-filter or CSS rims.
 *
 * Architecture (matches liquid-glass-studio):
 * - Parent LiquidGlassToolbar: WebGL shader provides glass effect + edge lighting
 * - Child ToolbarButton: Simple translucent fill, no effects
 *
 * Features:
 * - No backdrop-filter (parent provides glass)
 * - No CSS rim (WebGL shader provides edge lighting via fresnel + glare)
 * - Region-tinted fill from material resolver
 * - Subtle specular highlight
 * - Hover/press states
 * - Adaptive text colors based on background luminance
 */
import { useAtomValue } from "jotai";
import { LucideIcon } from "lucide-react";
import React, { useEffect, useState } from "react";

import { LIQUID_GLASS_PRESSED } from "@src/components/LiquidGlass/hoverConfig";
import { useGlassMaterial } from "@src/hooks/theme/useGlassMaterial";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { backgroundImageAtom } from "@src/store";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

// ============================================
// Types
// ============================================

export interface ToolbarButtonProps {
  /** Click handler */
  onClick?: () => void;
  /** Button content - Lucide icon component */
  icon?: LucideIcon;
  /** Text label */
  label?: string;
  /** Children content */
  children?: React.ReactNode;
  /** Tooltip text */
  title?: string;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Whether button is in selected/active state */
  selected?: boolean;
  /** Button size */
  size?: "small" | "medium";
  /** Button shape */
  shape?: "round" | "pill";
  /** Additional styles */
  style?: React.CSSProperties;
  /** Additional className */
  className?: string;
}

// ============================================
// Component
// ============================================

export const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  icon,
  label,
  children,
  title,
  disabled = false,
  selected = false,
  size = "small",
  shape = "round",
  style,
  className = "",
}) => {
  const [ref, isHovered] = useSafeHover<HTMLButtonElement>({ disabled });
  const [isPressed, setIsPressed] = useState(false);
  useEffect(() => () => setIsPressed(false), []);
  const { isDark } = useCurrentTheme();

  // Get toolbar region material for consistent tinting
  useGlassMaterial("toolbar", {
    thickness: "thin",
  });

  // Adaptive colors based on background luminance
  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;

  // Text color: use adaptive color when enabled, otherwise CSS variable
  const textColor = adaptiveEnabled
    ? toolbarLuminance.textColor
    : "var(--color-text-1)";

  // Size configuration
  const sizeConfig = {
    small: {
      height: 28,
      width: 28,
      padding: shape === "round" ? 0 : 12,
      iconSize: 14,
    },
    medium: {
      height: 36,
      width: 36,
      padding: shape === "round" ? 0 : 16,
      iconSize: 14,
    },
  };
  const config = sizeConfig[size];

  // Width for round buttons (use config width)
  const width = shape === "round" ? config.width : undefined;

  // Render icon
  const renderIcon = () => {
    if (!icon) return null;

    const IconComponent = icon;
    return (
      <IconComponent
        size={config.iconSize}
        strokeWidth={1.75}
        style={{ color: selected ? "white" : textColor }}
      />
    );
  };

  return (
    <button
      ref={ref}
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseLeave={() => setIsPressed(false)}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        height: `${config.height}px`,
        width: width ? `${width}px` : undefined,
        padding: width ? 0 : `0 ${config.padding}px`,
        borderRadius: "100px",
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.15s ease",
        outline: "none",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Hover overlay */}
      {!disabled && !selected && isHovered && !isPressed && (
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
      {!disabled && !selected && isPressed && (
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
      {/* Content layer - no competing effects, parent LiquidGlassToolbar provides all glass effects */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        {renderIcon()}
        {label && (
          <span
            style={{
              fontSize: "14px",
              fontWeight: 400,
              color: selected ? "var(--color-primary-6)" : textColor,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        )}
        {children}
      </div>
    </button>
  );
};

export default ToolbarButton;
