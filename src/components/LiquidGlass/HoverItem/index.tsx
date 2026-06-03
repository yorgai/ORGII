/**
 * LiquidGlassHoverItem Component
 *
 * A reusable wrapper for interactive items with liquid glass hover effects.
 * Uses centralized hover configuration for consistent behavior.
 *
 * @example
 * ```tsx
 * <LiquidGlassHoverItem onClick={handleClick}>
 *   <span>Menu Item</span>
 * </LiquidGlassHoverItem>
 *
 * // Disable hover when selected
 * <LiquidGlassHoverItem hoverEnabled={!isSelected}>
 *   <span>Selected Item</span>
 * </LiquidGlassHoverItem>
 * ```
 */
import React, { CSSProperties } from "react";

import {
  LIQUID_GLASS_HOVER_VARIANTS,
  useHoverIntensity,
} from "@src/components/LiquidGlass/hoverConfig";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

export interface LiquidGlassHoverItemProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onClick" | "onMouseDown" | "onMouseEnter" | "onMouseLeave"
> {
  /** Content to render */
  children: React.ReactNode;
  /** Click handler */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Mouse down handler (e.g. prevent focus ring on section toggle) */
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Mouse enter handler */
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Mouse leave handler */
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Additional CSS classes */
  className?: string;
  /** Custom inline styles */
  style?: CSSProperties;
  /** Whether hover effect is enabled (default: true) */
  hoverEnabled?: boolean;
  /** Disabled state */
  disabled?: boolean;
  dataTestId?: string;
}

const LiquidGlassHoverItem: React.FC<LiquidGlassHoverItemProps> = ({
  children,
  onClick,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  className = "",
  style,
  hoverEnabled = true,
  disabled = false,
  dataTestId,
  ...rest
}) => {
  const [ref, isHovered] = useSafeHover<HTMLDivElement>({
    disabled: disabled || !hoverEnabled,
  });
  const { isDark } = useCurrentTheme();
  const hoverIntensity = useHoverIntensity();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    onClick?.(e);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    onMouseEnter?.(e);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    onMouseLeave?.(e);
  };

  return (
    <div
      ref={ref}
      {...rest}
      data-testid={dataTestId}
      className={`transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative",
        background:
          isHovered && hoverEnabled
            ? isDark
              ? LIQUID_GLASS_HOVER_VARIANTS[hoverIntensity].dark
              : LIQUID_GLASS_HOVER_VARIANTS[hoverIntensity].light
            : "transparent",
        transition: "background 0.15s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default LiquidGlassHoverItem;
