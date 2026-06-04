import React from "react";

import { cn } from "./cn";
import { BoldStableLabel } from "./tabContent";
import type { TabPillItem } from "./types";

export const SidebarTabButton: React.FC<{
  tab: TabPillItem;
  isActive: boolean;
  onClick: () => void;
  iconOnly?: boolean;
}> = ({ tab, isActive, onClick, iconOnly }) => {
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
        isActive
          ? "bg-bg-2 text-text-1"
          : "bg-transparent text-text-2 hover:bg-fill-2 hover:text-text-1",
        tab.disabled && "cursor-not-allowed opacity-50",
        "transition-colors duration-150"
      )}
      title={iconOnly ? tab.label : undefined}
    >
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
