import React from "react";

import { cn } from "./cn";
import { BoldStableLabel } from "./tabContent";
import type { TabPillItem } from "./types";

export const SidebarTabButton: React.FC<{
  tab: TabPillItem;
  isActive: boolean;
  onClick: () => void;
  iconOnly?: boolean;
  regionTintRGB?: { r: number; g: number; b: number } | null;
  isDark: boolean;
}> = ({ tab, isActive, onClick, iconOnly, regionTintRGB, isDark }) => {
  const activeFill = isDark
    ? "rgba(60, 60, 60, 0.45)"
    : "rgba(255, 255, 255, 0.42)";

  const tabStyles: React.CSSProperties = isActive
    ? {
        backgroundColor: activeFill,
        boxShadow: "none",
        transition: "all 0.15s ease",
      }
    : {
        backgroundColor: "transparent",
        transition: "color 0.15s ease",
      };

  return (
    <button
      onClick={onClick}
      disabled={tab.disabled}
      data-action="panel.setLeftTab"
      data-action-id={tab.key}
      data-testid={tab.dataTestId}
      className={cn(
        "group relative flex flex-1 cursor-pointer select-none items-center justify-center",
        "overflow-hidden rounded-[100px] border-none",
        "h-[28px] px-[10px]",
        isActive ? "text-text-1" : "text-text-2",
        tab.disabled && "cursor-not-allowed opacity-50",
        "transition-colors duration-150"
      )}
      style={tabStyles}
      title={iconOnly ? tab.label : undefined}
    >
      {isActive && regionTintRGB && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[100px]"
          style={{
            background: `rgba(${regionTintRGB.r}, ${regionTintRGB.g}, ${regionTintRGB.b}, 0.02)`,
            mixBlendMode: "color",
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-[10px]">
        {iconOnly && tab.icon && (
          <div
            className={cn(
              "flex flex-shrink-0 items-center justify-center",
              isActive ? "text-text-1" : "text-text-2"
            )}
          >
            {tab.icon}
          </div>
        )}
        {!iconOnly && (
          <span
            className={cn("text-xs", isActive ? "text-text-1" : "text-text-2")}
          >
            <BoldStableLabel label={tab.label} isBold={isActive} />
          </span>
        )}
      </div>
    </button>
  );
};
