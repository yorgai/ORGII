/**
 * SpanningEventCard Component
 *
 * Renders a multi-day event bar that spans across day columns.
 * Handles visual indicators for events that continue from/to adjacent weeks.
 */
import React from "react";

import SessionHoverCard from "@src/components/SessionHoverCard";
import {
  STATUS_COLORS,
  WORK_ITEM_STATUS_COLOR,
} from "@src/types/core/viewStatus";
import type { WorkItemStatus } from "@src/types/core/workItem";

import type { CalendarEvent } from "../../types";

// ============================================
// Types
// ============================================

export interface SpanningEventCardProps {
  /** Event data */
  event: CalendarEvent;
  /** Click handler */
  onClick?: (event: CalendarEvent) => void;
  /** Whether this event is selected */
  isSelected?: boolean;
  /** Event continues from previous week (no left rounded corner) */
  isContinuation?: boolean;
  /** Event continues to next week (no right rounded corner) */
  continuesNext?: boolean;
}

// ============================================
// Helpers
// ============================================

function getEventColor(status?: WorkItemStatus, customColor?: string) {
  if (customColor) {
    return {
      bg: customColor,
      text: "#fff",
    };
  }

  const colorKey = WORK_ITEM_STATUS_COLOR[status || "backlog"];
  const color = STATUS_COLORS[colorKey];

  return {
    bg: color.base,
    text: "#fff",
  };
}

// ============================================
// Component
// ============================================

const SpanningEventCard: React.FC<SpanningEventCardProps> = ({
  event,
  onClick,
  isSelected = false,
  isContinuation = false,
  continuesNext = false,
}) => {
  const handleClick = (clickEvent: React.MouseEvent) => {
    clickEvent.stopPropagation();
    onClick?.(event);
  };

  const colors = getEventColor(event.status, event.color);

  // Dynamic border radius based on continuation
  const borderRadius = `${isContinuation ? "0" : "4px"} ${continuesNext ? "0" : "4px"} ${continuesNext ? "0" : "4px"} ${isContinuation ? "0" : "4px"}`;

  return (
    <SessionHoverCard sessionId={event.id} position="right-start">
      <button
        onClick={handleClick}
        className={`flex h-full w-full items-center overflow-hidden px-2 text-left text-xs font-medium transition-all hover:brightness-110 ${
          isSelected ? "ring-2 ring-primary-6 ring-offset-1" : ""
        }`}
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          borderRadius,
        }}
      >
        <span className="truncate">{event.title}</span>
      </button>
    </SessionHoverCard>
  );
};

export default SpanningEventCard;
