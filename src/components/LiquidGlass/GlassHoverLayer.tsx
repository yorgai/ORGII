/**
 * GlassHoverLayer Component
 *
 * A reusable wrapper for interactive items with liquid glass hover effects.
 * Uses centralized hover configuration for consistent behavior.
 *
 * @example
 * ```tsx
 * <GlassHoverLayer onClick={handleClick}>
 *   <span>Menu Item</span>
 * </GlassHoverLayer>
 *
 * // Disable hover when selected
 * <GlassHoverLayer hoverEnabled={!isSelected}>
 *   <span>Selected Item</span>
 * </GlassHoverLayer>
 * ```
 */
import React, { CSSProperties } from "react";

import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { LIQUID_GLASS_HOVER } from "./hoverConfig";

export interface GlassHoverLayerProps {
  /** Content to render */
  children: React.ReactNode;
  /** Click handler */
  onClick?: (e: React.MouseEvent) => void;
  /** Additional CSS classes */
  className?: string;
  /** Custom inline styles */
  style?: CSSProperties;
  /** Whether hover effect is enabled (default: true) */
  hoverEnabled?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

const GlassHoverLayer: React.FC<GlassHoverLayerProps> = ({
  children,
  onClick,
  className = "",
  style,
  hoverEnabled = true,
  disabled = false,
}) => {
  const [ref, isHovered] = useSafeHover<HTMLDivElement>({
    disabled: disabled || !hoverEnabled,
  });
  const { isDark } = useCurrentTheme();

  const handleClick = (event: React.MouseEvent) => {
    if (disabled) return;
    onClick?.(event);
  };

  return (
    <div
      ref={ref}
      className={`transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`}
      onClick={handleClick}
      style={{
        position: "relative",
        background:
          isHovered && hoverEnabled
            ? isDark
              ? LIQUID_GLASS_HOVER.dark
              : LIQUID_GLASS_HOVER.light
            : "transparent",
        transition: "background 0.15s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default GlassHoverLayer;
