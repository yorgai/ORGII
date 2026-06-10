import React from "react";

import { cn } from "./cn";

export const TAB_PILL_SELECT_28_TEXT_CLASS = "text-[14px]";

export const TAB_PILL_SURFACE_BASE_CLASS =
  "relative flex h-8 min-w-0 cursor-pointer select-none items-center overflow-hidden rounded-lg transition-colors duration-150";

type TabPillSurfaceElement = HTMLButtonElement | HTMLDivElement;

export interface TabPillSurfaceProps extends React.HTMLAttributes<TabPillSurfaceElement> {
  as?: "button" | "div";
  textClassName?: string;
}

export const TabPillSurface = React.forwardRef<
  TabPillSurfaceElement,
  TabPillSurfaceProps
>(({ as = "div", className, textClassName, children, ...props }, ref) => {
  const surfaceClassName = cn(
    TAB_PILL_SURFACE_BASE_CLASS,
    textClassName,
    className
  );

  if (as === "button") {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={surfaceClassName}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={surfaceClassName}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
});

TabPillSurface.displayName = "TabPillSurface";
