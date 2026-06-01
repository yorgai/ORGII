/**
 * SwitchButton Component
 *
 * A reusable icon button for segmented toolbar switches.
 * Used by ViewModeSwitch and AppModeSwitch.
 *
 * Features:
 * - Icon-only button with hover state
 * - Selected state uses primary color fill
 * - Non-selected state uses transparent with hover overlay
 * - Consistent sizing: 28px height, 28px width
 * - Adaptive text colors based on background luminance
 */
import { useAtomValue } from "jotai";
import type { LucideIcon } from "lucide-react";
import React, { useEffect, useState } from "react";

import { LIQUID_GLASS_PRESSED } from "@src/components/LiquidGlass/hoverConfig";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { backgroundImageAtom } from "@src/store";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import SegmentedIconButton from "../SegmentedIconButton";

// ============================================
// Types
// ============================================

export interface SwitchButtonProps {
  /** Lucide icon component to render */
  icon: LucideIcon;
  /** Click handler */
  onClick: () => void;
  /** Tooltip text */
  title?: string;
  /** Whether this button is currently selected */
  selected: boolean;
}

// ============================================
// Component
// ============================================

export const SwitchButton: React.FC<SwitchButtonProps> = ({
  icon: Icon,
  onClick,
  title,
  selected,
}) => {
  const [ref, isHovered] = useSafeHover<HTMLButtonElement>();
  const [isPressed, setIsPressed] = useState(false);
  useEffect(() => () => setIsPressed(false), []);
  const { isDark } = useCurrentTheme();

  // Adaptive colors based on background luminance
  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;

  // Text color for non-selected state
  const textColor = adaptiveEnabled ? toolbarLuminance.textColor : undefined;

  return (
    <SegmentedIconButton
      ref={ref}
      icon={Icon}
      selected={selected}
      onClick={onClick}
      title={title}
      unselectedClassName={`bg-transparent ${!adaptiveEnabled ? "text-text-1" : ""}`}
      style={!selected && textColor ? { color: textColor } : undefined}
      iconColor={selected ? "white" : "currentColor"}
      onMouseLeave={() => setIsPressed(false)}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      overlay={
        <>
          {!selected && isHovered && !isPressed ? (
            <div
              className="pointer-events-none absolute inset-0 z-0 rounded-[100px]"
              style={{ background: "var(--color-fill-3)" }}
            />
          ) : null}
          {!selected && isPressed ? (
            <div
              className="pointer-events-none absolute inset-0 z-0 rounded-[100px]"
              style={{
                background: isDark
                  ? LIQUID_GLASS_PRESSED.dark
                  : LIQUID_GLASS_PRESSED.light,
              }}
            />
          ) : null}
        </>
      }
    />
  );
};

export default SwitchButton;
