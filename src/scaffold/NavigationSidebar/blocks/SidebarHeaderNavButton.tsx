import type { LucideIcon } from "lucide-react";
import React from "react";

import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";

interface SidebarHeaderNavButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  bold?: boolean;
}

const SidebarHeaderNavButton: React.FC<SidebarHeaderNavButtonProps> = ({
  icon: Icon,
  label,
  onClick,
  ariaLabel,
  className = "",
  bold = true,
}) => {
  return (
    <LiquidGlassHoverItem
      className={`group flex min-h-[36px] w-full items-center justify-between overflow-hidden rounded-lg px-2 text-text-1 ${className}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? label}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Icon size={14} strokeWidth={2} className="flex-shrink-0 text-text-1" />
        <span
          className={`min-w-0 truncate text-[13px] text-text-1 ${bold ? "font-bold" : ""}`}
        >
          {label}
        </span>
      </span>
    </LiquidGlassHoverItem>
  );
};

export default SidebarHeaderNavButton;
