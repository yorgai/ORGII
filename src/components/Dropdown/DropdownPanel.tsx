/**
 * DropdownPanel Component
 *
 * Base dropdown panel container with consistent styling.
 * Use this as the container for all dropdown content.
 *
 * @example
 * ```tsx
 * import { DropdownPanel } from "@src/components/Dropdown";
 *
 * // Basic usage
 * <DropdownPanel>
 *   <DropdownItem>Option 1</DropdownItem>
 *   <DropdownItem>Option 2</DropdownItem>
 * </DropdownPanel>
 *
 * // With portal positioning
 * <DropdownPanel
 *   style={{
 *     position: "fixed",
 *     top: 100,
 *     left: 200,
 *   }}
 * >
 *   ...
 * </DropdownPanel>
 * ```
 */
import React, { forwardRef } from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { DROPDOWN_CLASSES, DROPDOWN_PANEL, DROPDOWN_STYLES } from "./tokens";

export interface DropdownPanelProps {
  /**
   * Panel content
   */
  children: React.ReactNode;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style (for positioning)
   */
  style?: React.CSSProperties;

  /**
   * Custom width
   */
  width?: number | string;

  /**
   * Custom min-width
   */
  minWidth?: number | string;

  /**
   * Custom max-height (overrides default 256px)
   */
  maxHeight?: number | string;

  /**
   * Whether to animate the panel entrance
   * @default true
   */
  animated?: boolean;

  /**
   * Event handlers
   */
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

const DropdownPanel = forwardRef<HTMLDivElement, DropdownPanelProps>(
  (
    {
      children,
      className = "",
      style,
      width,
      minWidth,
      maxHeight = DROPDOWN_PANEL.maxHeight,
      animated = true,
      onMouseEnter,
      onMouseLeave,
    },
    ref
  ) => {
    const { isDark } = useCurrentTheme();

    const panelClasses = [
      animated ? DROPDOWN_CLASSES.panelAnimated : DROPDOWN_CLASSES.panel,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const panelStyle: React.CSSProperties = {
      ...(isDark
        ? DROPDOWN_STYLES.panelShadowDark
        : DROPDOWN_STYLES.panelShadow),
      ...(width !== undefined && { width }),
      ...(minWidth !== undefined && { minWidth }),
      ...(maxHeight !== undefined && { maxHeight }),
      ...style,
    };

    return (
      <div
        ref={ref}
        className={panelClasses}
        style={panelStyle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </div>
    );
  }
);

DropdownPanel.displayName = "DropdownPanel";

export default DropdownPanel;
