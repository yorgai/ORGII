/**
 * Binary search for the largest index whose event.createdAt is <= cursorMs.
 *
 * Used by SubagentBlock / NestedActivityList to map the main replay cursor
 * onto a subagent's own event timeline.
 *
 * Events must be sorted ascending by createdAt.
 *
 * Clamping behaviour:
 * - cursor is after the last event  → last index  (subagent already finished)
 * - cursor is before the first event → 0           (subagent not yet started)
 * - cursor is in range               → closest index at or before cursor
 */
import type { SessionEvent } from "@src/engines/SessionCore";

export function findIndexAtTime(
  events: SessionEvent[],
  cursorMs: number
): number {
  if (events.length === 0) return -1;
  const firstMs = new Date(events[0].createdAt).getTime();
  if (cursorMs < firstMs) return 0;
  let lo = 0;
  let hi = events.length - 1;
  let best = events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = new Date(events[mid].createdAt).getTime();
    if (t <= cursorMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
