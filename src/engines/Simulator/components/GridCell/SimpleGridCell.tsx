/**
 * SimpleGridCell
 *
 * Basic memoized grid cell without independent replay.
 * Used for single-cell mode or when independent replay is not needed.
 * Custom memo comparison prevents unnecessary re-renders.
 */
import { memo } from "react";

import type { SessionEvent } from "@src/engines/SessionCore";

import SimulatorContentArea from "../../SimulatorMainPane";
import type { GridCellProps } from "../../types/gridTypes";

const SimpleGridCell = memo<
  GridCellProps & { currentEvent: SessionEvent | null }
>(
  ({ index, color, currentEvent, events, specs, forceAppType }) => (
    <SimulatorContentArea
      index={index}
      agentColor={color}
      currentEvent={currentEvent}
      events={events}
      specs={specs}
      forceAppType={forceAppType}
      hideHeader={true}
    />
  ),
  (prev, next) => {
    // Re-render if visual props changed
    if (prev.index !== next.index) return false;
    if (prev.color !== next.color) return false;

    // Re-render if event changed
    const prevEventId = prev.currentEvent?.chunk_id;
    const nextEventId = next.currentEvent?.chunk_id;

    if (prevEventId || nextEventId) {
      if (prevEventId !== nextEventId) return false;
    } else {
      if (prev.currentEvent !== next.currentEvent) return false;
      if (prev.currentEvent?.createdAt !== next.currentEvent?.createdAt)
        return false;
    }

    // Also check functionName changes for same chunk_id
    if (prev.currentEvent?.functionName !== next.currentEvent?.functionName)
      return false;

    if (prev.forceAppType !== next.forceAppType) return false;

    return true;
  }
);
SimpleGridCell.displayName = "SimpleGridCell";

export { SimpleGridCell };
