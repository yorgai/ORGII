import { MoreHorizontal } from "lucide-react";
import React from "react";

import type { NavigationMenuItem } from "../config";

interface NavigationMenuRowActionButtonProps {
  icon?: NavigationMenuItem["rowActionIcon"];
  label: string;
  active?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function NavigationMenuRowActionButton({
  icon,
  label,
  active = false,
  onClick,
}: NavigationMenuRowActionButtonProps): React.ReactElement {
  const RowActionIcon = icon ?? MoreHorizontal;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors duration-150 hover:bg-fill-2 hover:text-text-1 focus:outline-none ${
        active ? "text-primary-6" : "text-text-3"
      }`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
    >
      {React.createElement(RowActionIcon, {
        size: 14,
        strokeWidth: icon ? 2 : 1.75,
      })}
    </button>
  );
}
