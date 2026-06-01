/**
 * Chat Item Pipeline — Utilities
 *
 * Small helper functions shared across the pipeline.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "./types";

/**
 * Check if two events can be consolidated (same thread, consecutive parts)
 */
export const canConsolidate = (
  first: SessionEvent,
  second: SessionEvent
): boolean => {
  if (first.args?.thread_id !== second.args?.thread_id) return false;
  if (first.actionType !== second.actionType) return false;
  const firstPart = first.args?.observation_part as string;
  const secondPart = second.args?.observation_part as string;
  if (!firstPart || !secondPart) return false;
  const firstMatch = firstPart.match(/part (\d+)\/(\d+)/);
  const secondMatch = secondPart.match(/part (\d+)\/(\d+)/);
  if (!firstMatch || !secondMatch) return false;
  const firstNum = parseInt(firstMatch[1]);
  const secondNum = parseInt(secondMatch[1]);
  return secondNum === firstNum + 1;
};

/**
 * Merge observations from multiple events into a single string.
 */
export const mergeObservations = (events: SessionEvent[]): string => {
  return events
    .map((event) => {
      const obs = event.result?.observation as string;
      return obs || "";
    })
    .filter(Boolean)
    .join("\n");
};

/**
 * Calculate duration from first to last item (in seconds).
 */
export function calculateDuration(
  items: OptimizedChatItem[]
): number | undefined {
  const timestamps = items
    .map((item) => {
      const time = item.event?.createdAt;
      return time ? new Date(time).getTime() : null;
    })
    .filter((time): time is number => time !== null);

  if (timestamps.length < 2) return undefined;

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  return Math.round((maxTime - minTime) / 1000);
}
