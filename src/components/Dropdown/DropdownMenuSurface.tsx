import React from "react";
import ReactDOM from "react-dom";

import { getPositionClasses } from "./positioning";
import { DROPDOWN_PANEL } from "./tokens";
import type { DropdownPosition } from "./types";

interface DropdownMenuSurfaceProps {
  visible: boolean;
  getPopupContainer?: () => HTMLElement;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  position: DropdownPosition;
  className: string;
  style?: React.CSSProperties;
  dropdownPosition: {
    top: number;
    left: number;
    transform?: string;
  } | null;
  trigger: "click" | "hover";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
}

const DropdownMenuSurface: React.FC<DropdownMenuSurfaceProps> = ({
  visible,
  getPopupContainer,
  dropdownRef,
  position,
  className,
  style,
  dropdownPosition,
  trigger,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  if (!visible) return null;

  if (getPopupContainer) {
    const container = getPopupContainer();
    const dropdownContent = (
      <div
        ref={dropdownRef}
        className={`pointer-events-auto fixed min-w-fit ${DROPDOWN_PANEL.zIndexClass} ${className}`}
        style={{
          ...style,
          top: dropdownPosition ? `${dropdownPosition.top}px` : undefined,
          left: dropdownPosition ? `${dropdownPosition.left}px` : undefined,
          transform: dropdownPosition?.transform,
        }}
        onMouseEnter={trigger === "hover" ? onMouseEnter : undefined}
        onMouseLeave={trigger === "hover" ? onMouseLeave : undefined}
      >
        {children}
      </div>
    );
    return ReactDOM.createPortal(dropdownContent, container);
  }

  return (
    <div
      ref={dropdownRef}
      className={`pointer-events-auto absolute min-w-fit ${DROPDOWN_PANEL.zIndexClass} ${getPositionClasses(position)} ${className}`}
      style={style}
      onMouseEnter={trigger === "hover" ? onMouseEnter : undefined}
      onMouseLeave={trigger === "hover" ? onMouseLeave : undefined}
    >
      {children}
    </div>
  );
};

export default DropdownMenuSurface;
