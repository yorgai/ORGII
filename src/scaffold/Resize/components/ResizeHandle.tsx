/**
 * ResizeHandle Component
 *
 * Unified resize handle for all split/panel resizing across the app.
 *
 * Features:
 * - 1px visible line with larger hit area (12px) for easier dragging
 * - Hover: primary-6 at 50% opacity
 * - Active (resizing): solid primary-6
 * - Two visual variants: "border" (visible 1px line, default) and "transparent" (invisible at rest)
 * - Double-click prevention
 * - Accessible with proper cursor feedback
 */
import React, { memo, useCallback, useRef } from "react";

import type { ResizeHandleProps } from "../types";

// ============================================
// Component
// ============================================

export const ResizeHandle: React.FC<ResizeHandleProps> = memo(
  ({
    axis,
    onMouseDown,
    onContextMenu,
    isResizing = false,
    variant = "border",
    noHover = false,
    noAccent = false,
    className = "",
  }) => {
    const isVertical = axis === "x";
    const lastClickTimeRef = useRef<number>(0);

    const handleMouseDown = useCallback(
      (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        if (now - lastClickTimeRef.current < 300) {
          return;
        }
        lastClickTimeRef.current = now;
        onMouseDown(event);
      },
      [onMouseDown]
    );

    const handleDoubleClick = useCallback((event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    }, []);

    const preventClick = useCallback((event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    }, []);

    const restingBg = variant === "border" ? "bg-border-2" : "bg-transparent";

    const wrapperClasses = [
      "resize-handle",
      "relative",
      "z-20",
      "flex-shrink-0",
      isVertical ? "cursor-col-resize" : "cursor-row-resize",
      isVertical ? "w-[1px]" : "h-[1px]",
      className,
    ].join(" ");

    const hoverBg = noAccent
      ? ""
      : "group-hover/resize:bg-[color-mix(in_srgb,var(--color-primary-6)_50%,transparent)]";
    const activeBg = noAccent ? "bg-transparent" : "bg-primary-6";

    const lineClasses = [
      "absolute",
      "inset-0",
      "transition-colors",
      "duration-150",
      noHover ? restingBg : isResizing ? activeBg : `${restingBg} ${hoverBg}`,
    ].join(" ");

    const hitAreaClasses = isVertical
      ? "absolute inset-y-0 -left-[6px] w-[13px] cursor-col-resize"
      : "absolute inset-x-0 -top-[6px] h-[13px] cursor-row-resize";

    return (
      <div
        className={`${wrapperClasses} group/resize`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={onContextMenu}
        onClick={preventClick}
        role="separator"
        aria-orientation={isVertical ? "vertical" : "horizontal"}
      >
        {/* Visible 1px line — color changes on group hover */}
        <div className={lineClasses} />
        {/* Larger hit area for easier dragging */}
        <div
          className={hitAreaClasses}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          onContextMenu={onContextMenu}
          onClick={preventClick}
        />
      </div>
    );
  }
);

ResizeHandle.displayName = "ResizeHandle";

// ============================================
// Convenience Components
// ============================================

/**
 * Vertical resize handle (for left/right panel resizing — col-resize cursor)
 */
export const VerticalResizeHandle: React.FC<Omit<ResizeHandleProps, "axis">> =
  memo((props) => <ResizeHandle {...props} axis="x" />);

VerticalResizeHandle.displayName = "VerticalResizeHandle";

/**
 * Horizontal resize handle (for top/bottom panel resizing — row-resize cursor)
 */
export const HorizontalResizeHandle: React.FC<Omit<ResizeHandleProps, "axis">> =
  memo((props) => <ResizeHandle {...props} axis="y" />);

HorizontalResizeHandle.displayName = "HorizontalResizeHandle";

export default ResizeHandle;
