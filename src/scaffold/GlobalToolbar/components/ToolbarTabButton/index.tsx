/**
 * ToolbarTabButton — shared tab-switch button for center toolbar pills.
 *
 * Selected state: fill-2 background, primary-6 icon + label.
 * Unselected state: transparent icon + label with adaptive text color.
 *
 * Used by toolbar pill controls such as FactoryViewPill.
 */
import { useAtomValue } from "jotai";
import type { LucideIcon } from "lucide-react";
import React, { useEffect, useState } from "react";

import { LIQUID_GLASS_PRESSED } from "@src/components/LiquidGlass/hoverConfig";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { backgroundImageAtom } from "@src/store";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

export interface ToolbarTabButtonProps {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onClick: () => void;
}

const ToolbarTabButton: React.FC<ToolbarTabButtonProps> = ({
  label,
  icon: Icon,
  selected,
  onClick,
}) => {
  const [ref, isHovered] = useSafeHover<HTMLButtonElement>();
  const [isPressed, setIsPressed] = useState(false);
  useEffect(() => () => setIsPressed(false), []);
  const { isDark } = useCurrentTheme();

  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;
  const textColor = adaptiveEnabled ? toolbarLuminance.textColor : undefined;

  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseLeave={() => setIsPressed(false)}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      className={`relative flex h-[28px] cursor-pointer items-center justify-center overflow-hidden rounded-[100px] border-none px-3 transition-all duration-200 ${
        selected
          ? "bg-fill-2 text-primary-6"
          : `bg-transparent ${!adaptiveEnabled ? "text-text-1" : ""}`
      }`}
      style={!selected && textColor ? { color: textColor } : undefined}
    >
      {!selected && isHovered && !isPressed && (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-[100px]"
          style={{
            background: "var(--color-fill-2)",
          }}
        />
      )}
      {!selected && isPressed && (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-[100px]"
          style={{
            background: isDark
              ? LIQUID_GLASS_PRESSED.dark
              : LIQUID_GLASS_PRESSED.light,
          }}
        />
      )}
      <span className="relative z-[1] flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium">
        <Icon size={14} strokeWidth={1.75} color="currentColor" />
        {label}
      </span>
    </button>
  );
};

export default ToolbarTabButton;
