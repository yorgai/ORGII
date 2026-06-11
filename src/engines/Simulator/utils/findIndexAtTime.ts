/**
 * Canonical "find event index at cursor timestamp" binary search.
 *
 * Single source of truth for mapping a cursor timestamp onto a sorted-by-time
 * event array. Previously copies of this routine lived in three places with
 * subtly different pre-spawn semantics — that divergence directly caused the
 * "blank final frame" bug, so callers MUST use this util now.
 *
 * Timestamp domain
 * ----------------
 * Events expose `createdAt` (start time). The merge util
 * `mergeSessionEventsToolResultsByCallId` also stamps `lastActivityAt`
 * (= max createdAt across the call+results group) on merged tool-call
 * events. We use `lastActivityAt ?? createdAt` so a cursor sitting at the
 * tail covers tool-result content whose timestamp is later than the
 * folded-into call's `createdAt`.
 *
 * Events must be sorted ascending by `createdAt`.
 *
 * `preStart` behaviour
 * --------------------
 *  - "clamp"  — cursor before first event → index 0 (subagent not yet
 *               started, but show its first event so the cell isn't blank).
 *               Used by the grid-cell replay engine.
 *  - "empty"  — cursor before first event → -1 (caller renders an empty list
 *               / "pre-spawn" placeholder). Used by nested replay views.
 *
 * Defensive behaviour
 * -------------------
 *  - Empty array → -1.
 *  - Non-finite timestamps mid-array are treated as "no information",
 *    skipping them rather than poisoning the binary search.
 */
import type { SessionEvent } from "@src/engines/SessionCore";

export interface FindIndexAtTimeOptions {
  /** What to return when the cursor precedes the first event. Default "clamp". */
  preStart?: "clamp" | "empty";
}

export interface SessionEventWithActivity extends SessionEvent {
  lastActivityAt?: string;
}

/**
 * Resolve the effective replay timestamp for an event in ms.
 *
 * For merged tool-call events (produced by `mergeSessionEventsToolResultsByCallId`)
 * this is `lastActivityAt`. For everything else it's `createdAt`.
 */
export function eventReplayTimeMs(event: SessionEvent): number {
  const withActivity = event as SessionEventWithActivity;
  const candidate = withActivity.lastActivityAt ?? event.createdAt;
  const t = Date.parse(candidate);
  if (Number.isFinite(t)) return t;
  const fallback = Date.parse(event.createdAt);
  return Number.isFinite(fallback) ? fallback : Number.NaN;
}

export function findIndexAtTime(
  events: SessionEvent[],
  cursorMs: number,
  options: FindIndexAtTimeOptions = {}
): number {
  if (events.length === 0) return -1;
  const preStart = options.preStart ?? "clamp";

  const firstMs = eventReplayTimeMs(events[0]);
  if (Number.isFinite(firstMs) && cursorMs < firstMs) {
    return preStart === "clamp" ? 0 : -1;
  }

  let lo = 0;
  let hi = events.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let t = eventReplayTimeMs(events[mid]);
    let probe = mid;
    // Walk past non-finite timestamps so a single corrupt row in the middle
    // can't poison the search. We bias right first (toward later events,
    // matching "≤ cursor" semantics); if the right side is exhausted we
    // bias left.
    while (!Number.isFinite(t) && probe < hi) {
      probe++;
      t = eventReplayTimeMs(events[probe]);
    }
    while (!Number.isFinite(t) && probe > lo) {
      probe--;
      t = eventReplayTimeMs(events[probe]);
    }
    if (!Number.isFinite(t)) {
      // Entire [lo, hi] window is non-finite — give up, keep best so far.
      break;
    }
    if (t <= cursorMs) {
      best = probe;
      lo = probe + 1;
    } else {
      hi = probe - 1;
    }
  }

  if (best < 0) {
    // Cursor is before every parseable timestamp.
    return preStart === "clamp" ? 0 : -1;
  }
  return best;
}
