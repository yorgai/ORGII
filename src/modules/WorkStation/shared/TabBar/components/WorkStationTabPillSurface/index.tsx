import React from "react";

import { TabPillSurface } from "@src/components/TabPill";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

import {
  WORK_STATION_TAB_PILL_SURFACE_CLASS,
  WORK_STATION_TAB_PILL_TEXT_CLASS,
} from "./tokens";

type WorkStationTabPillElement = HTMLButtonElement | HTMLDivElement;

export interface WorkStationTabPillSurfaceProps extends React.HTMLAttributes<WorkStationTabPillElement> {
  as?: "button" | "div";
  isActive: boolean;
  isDragging?: boolean;
  hideLabel?: boolean;
  variant?: "standard" | "compact" | "session";
}

const VARIANT_CLASSES: Record<
  NonNullable<WorkStationTabPillSurfaceProps["variant"]>,
  string
> = {
  standard: "min-w-[3.5rem] max-w-[240px] shrink-0 gap-1.5 px-2.5",
  compact: "h-8 w-8 shrink-0 justify-center",
  session: "min-w-0 max-w-[180px] shrink-0 gap-1.5 px-2.5",
};

export const WORK_STATION_TAB_PILL_DRAG_OVERLAY_CLASS = `flex h-8 shrink-0 cursor-grabbing items-center gap-1.5 rounded-lg border border-border-2 ${SURFACE_TOKENS.selected} pl-2.5 pr-2 shadow-lg`;

export const WorkStationTabPillSurface = React.forwardRef<
  WorkStationTabPillElement,
  WorkStationTabPillSurfaceProps
>(
  (
    {
      as = "div",
      isActive,
      isDragging = false,
      hideLabel = false,
      variant = hideLabel ? "compact" : "standard",
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    const stateClass = isActive
      ? `work-station-editor-tab--active z-10 ${SURFACE_TOKENS.selected} text-primary-6 ${SURFACE_TOKENS.selectedHover}`
      : `bg-transparent text-text-2 ${SURFACE_TOKENS.hover}`;
    const draggingClass = isDragging
      ? `work-station-editor-tab--dragging cursor-grabbing ${SURFACE_TOKENS.selected} opacity-90`
      : "";
    const surfaceClassName = `${WORK_STATION_TAB_PILL_SURFACE_CLASS} ${VARIANT_CLASSES[variant]} ${stateClass} ${draggingClass} ${className}`;

    return (
      <TabPillSurface
        ref={ref}
        as={as}
        className={surfaceClassName}
        textClassName={WORK_STATION_TAB_PILL_TEXT_CLASS}
        {...props}
      >
        {children}
      </TabPillSurface>
    );
  }
);

WorkStationTabPillSurface.displayName = "WorkStationTabPillSurface";
