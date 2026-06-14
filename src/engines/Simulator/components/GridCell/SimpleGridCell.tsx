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

type RenderSignatureEvent =
  | (SessionEvent & { lastActivityAt?: string })
  | null
  | undefined;

function getEventRenderSignature(event: RenderSignatureEvent): string {
  if (!event) return "";
  return [
    event.id,
    event.chunk_id ?? "",
    event.functionName,
    event.displayStatus,
    event.displayText,
    event.displayVariant,
    event.lastActivityAt ?? "",
    event.args ? JSON.stringify(event.args) : "",
    event.result ? JSON.stringify(event.result) : "",
    event.extracted ? JSON.stringify(event.extracted) : "",
    event.payloadRefs ? JSON.stringify(event.payloadRefs) : "",
  ].join("|");
}

function getEventsTailSignature(
  events: readonly SessionEvent[] | undefined
): string {
  if (!events || events.length === 0) return "0";
  const tail = events[events.length - 1];
  return `${events.length}:${getEventRenderSignature(tail)}`;
}

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
    if (prev.index !== next.index) return false;
    if (prev.color !== next.color) return false;
    if (prev.forceAppType !== next.forceAppType) return false;
    if (prev.events !== next.events) return false;
    if (prev.specs !== next.specs) return false;

    if (
      getEventRenderSignature(prev.currentEvent) !==
      getEventRenderSignature(next.currentEvent)
    ) {
      return false;
    }

    if (
      getEventsTailSignature(prev.events) !==
      getEventsTailSignature(next.events)
    ) {
      return false;
    }

    return true;
  }
);
SimpleGridCell.displayName = "SimpleGridCell";

export { SimpleGridCell };
