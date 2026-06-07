import type React from "react";

interface NavigationMenuRowAccessorySlotProps {
  persistentContent?: React.ReactNode;
  hoverContent?: React.ReactNode;
  actionContent?: React.ReactNode;
}

export function NavigationMenuRowAccessorySlot({
  persistentContent,
  hoverContent,
  actionContent,
}: NavigationMenuRowAccessorySlotProps): React.ReactElement | null {
  if (!persistentContent && !hoverContent && !actionContent) return null;

  return (
    <span className="ml-1 grid flex-shrink-0 items-center justify-end leading-none">
      {persistentContent && (
        <span className="col-start-1 row-start-1 inline-flex items-center justify-end leading-none transition-opacity duration-150 group-hover:pointer-events-none group-hover:opacity-0">
          {persistentContent}
        </span>
      )}
      {(hoverContent || actionContent) && (
        <span className="pointer-events-none col-start-1 row-start-1 inline-flex max-w-0 items-center justify-end gap-1.5 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-150 group-hover:pointer-events-auto group-hover:max-w-[11rem] group-hover:opacity-100">
          {hoverContent && (
            <span className="inline-flex max-w-[4rem] items-center justify-end overflow-hidden">
              {hoverContent}
            </span>
          )}
          {actionContent && (
            <span className="inline-flex items-center justify-end gap-1">
              {actionContent}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
