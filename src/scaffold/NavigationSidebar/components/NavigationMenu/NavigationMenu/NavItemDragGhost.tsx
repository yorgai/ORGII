import React from "react";
import { createPortal } from "react-dom";

import type { NavItemDragState } from "./useNavItemDrag";

interface NavItemDragGhostProps {
  dragState: NavItemDragState;
}

/**
 * A floating pill ghost that follows the pointer while a navigation item
 * is being dragged toward the chat input / session creator.
 */
export const NavItemDragGhost: React.FC<NavItemDragGhostProps> = ({
  dragState,
}) => {
  if (!dragState.isDragging) return null;

  return createPortal(
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: dragState.dragX + 12,
        top: dragState.dragY - 14,
        pointerEvents: "none",
        zIndex: 99999,
        willChange: "transform",
      }}
    >
      <div className="flex items-center gap-1.5 rounded-full bg-bg-2 px-2.5 py-1 text-[12px] font-medium text-text-1 shadow-lg ring-1 ring-border-1">
        <span className="max-w-[160px] truncate">{dragState.dragLabel}</span>
      </div>
    </div>,
    document.body
  );
};
