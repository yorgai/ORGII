/**
 * EventBlockHeader - Reusable header component with optional navigate icon
 */
import React from "react";

import EventNavigateIcon from "./EventNavigateIcon";
import { getEventBlockHeaderClasses } from "./config";
import type { EventBlockHeaderProps } from "./types";

/**
 * Standard header for session event blocks.
 * When `onNavigate` is provided, shows an ArrowUpRight icon on hover.
 * When neither `onClick` nor `onNavigate` is set, cursor stays default.
 */
export const EventBlockHeader: React.FC<EventBlockHeaderProps> = ({
  isCollapsed,
  withHover = true,
  onNavigate,
  children,
  rightContent,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className = "",
}) => {
  const isClickable = !!(onClick || onNavigate);

  return (
    <div
      className={`group/chat-block-header ${getEventBlockHeaderClasses(isCollapsed, withHover, isClickable)} ${className}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Left content */}
      <div className="flex min-w-0 flex-1 items-center gap-2 leading-tight">
        {children}
      </div>

      {/* Right content + navigate icon */}
      {(onNavigate || rightContent) && (
        <div className="flex flex-shrink-0 items-center gap-1">
          {rightContent}
          {onNavigate && <EventNavigateIcon onClick={onNavigate} />}
        </div>
      )}
    </div>
  );
};

EventBlockHeader.displayName = "EventBlockHeader";

export default EventBlockHeader;
