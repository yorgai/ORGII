/**
 * Helpers for building the input list of a {@link ReplayTab}[] for
 * {@link ReplayTabBar}. Extracted so every consumer (CodeEditor, Browser,
 * and future simulator apps) agrees on the same ordering / capping rules
 * instead of reinventing a subtly different version.
 *
 * All helpers are pure and allocation-only: no React, no memoization baked
 * in. Callers are expected to wrap the call in `useMemo` with the right
 * dependency list.
 */
import type { ReplayTab } from "./ReplayTabBar";

/**
 * Default cap for replay tab bars. Matches the "last 5 events" spec and is
 * deliberately the same across consumers so the UX is predictable.
 */
export const MAX_REPLAY_TABS = 5;

/**
 * Single source for a mergeable tab list. Each entry is a {@link ReplayTab}
 * plus an ISO-timestamp used for newest-first sorting. Timestamps that are
 * falsy (empty / undefined) sort to the oldest end — useful for synthetic
 * "current" entries whose backing event has no `createdAt` yet.
 */
export interface TimestampedReplayTab extends ReplayTab {
  /** ISO-8601 timestamp (e.g. `SessionEvent.createdAt`). */
  createdAt: string;
}

/**
 * Merge N source lists of `TimestampedReplayTab` into a single newest-first
 * list, deduplicated by `eventId`. First occurrence wins (which, after the
 * sort, is the newest by definition).
 *
 * Why one helper instead of inlining: two separate consumers reinventing
 * this have historically diverged on (a) ascending vs descending sort and
 * (b) whether to dedupe at all. Centralising prevents that drift.
 */
export function mergeNewestFirstByTimestamp(
  sources: readonly TimestampedReplayTab[][]
): ReplayTab[] {
  const merged: TimestampedReplayTab[] = sources.flat();

  // ISO-8601 strings compare lexicographically, so localeCompare of the
  // *reverse* pair yields newest-first without parsing dates.
  merged.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const seen = new Set<string>();
  const out: ReplayTab[] = [];
  for (const e of merged) {
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    const { createdAt: _ignored, ...rest } = e;
    void _ignored;
    out.push(rest);
  }
  return out;
}

/**
 * Trim an already-ordered tab list to `max` entries while guaranteeing the
 * currently-active entry remains visible.
 *
 * Normally the last 5 entries suffice; but if the user selects something
 * from a sidebar that's older than the cap, that tab would silently vanish
 * from the bar. To avoid the "I clicked it, now it's gone" confusion we
 * append the active entry to the slice in that case (so the bar may briefly
 * have `max + 1` items — acceptable, explicit UX trade-off).
 */
export function capNewestWithActive(
  tabs: ReplayTab[],
  activeEventId: string | null,
  max: number = MAX_REPLAY_TABS
): ReplayTab[] {
  if (tabs.length <= max) return tabs;
  const capped = tabs.slice(0, max);
  if (!activeEventId) return capped;
  if (capped.some((t) => t.eventId === activeEventId)) return capped;
  const active = tabs.find((t) => t.eventId === activeEventId);
  return active ? [...capped, active] : capped;
}
