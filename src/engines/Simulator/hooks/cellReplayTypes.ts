/**
 * Types for useCellReplayState and related hooks.
 */
import type { SessionEvent } from "@src/engines/SessionCore";

export interface CellReplayState {
  /** Current event index in the events array */
  currentIndex: number;
  /** Whether the cell is currently auto-playing */
  isPlaying: boolean;
  /** Playback speed multiplier (1x, 2x, etc.) */
  playbackSpeed: number;
  /** Current event being displayed */
  currentEvent: SessionEvent | null;
  /** Total events count */
  totalEvents: number;
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether auto-scroll is enabled */
  autoScroll: boolean;
  /** True when the user has detached this cell from the main cursor (independent mode). */
  isDetached: boolean;
}

export interface CellReplayControls {
  /** Play/resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Go to next event */
  next: () => void;
  /** Go to previous event */
  prev: () => void;
  /** Jump to specific index */
  goToIndex: (index: number) => void;
  /** Jump to specific progress (0-100) */
  goToProgress: (progress: number) => void;
  /** Set playback speed */
  setSpeed: (speed: number) => void;
  /** Reset to beginning */
  reset: () => void;
  /** Jump to end (follow mode) */
  goToEnd: () => void;
  /** Re-attach this cell to the main replay cursor (clears user override). */
  syncToMain: () => void;
}

export interface UseCellReplayStateOptions {
  /** Events for this cell */
  events: SessionEvent[];
  /** Auto-play interval in ms (default: 1000) */
  autoPlayInterval?: number;
  /** Start at the end (follow mode) */
  startAtEnd?: boolean;
  /** Cell ID for debugging */
  cellId?: string;
  /**
   * External replay cursor in epoch ms. When non-null and the cell is not
   * user-detached, the cell shows the event whose createdAt is closest to
   * (but not after) this timestamp. Pass `null` to disable sync mode.
   */
  externalCursorMs?: number | null;
}

export interface UseCellReplayStateReturn {
  state: CellReplayState;
  controls: CellReplayControls;
}

/**
 * Binary search for the largest index whose event.createdAt is <= cursorMs.
 * Events must be sorted ascending by createdAt.
 *
 * Clamping behaviour:
 * - cursor is after the last event  → last index  (subagent already finished)
 * - cursor is before the first event → 0           (subagent not yet started)
 * - cursor is in range               → closest index at or before cursor
 *
 * This means a subagent cell always shows something meaningful even when the
 * main cursor sits outside the subagent's time window.
 */
export function findIndexAtTime(
  events: SessionEvent[],
  cursorMs: number
): number {
  if (events.length === 0) return -1;
  const firstMs = new Date(events[0].createdAt).getTime();
  // Cursor is before the first event — show the first event.
  if (cursorMs < firstMs) return 0;
  let lo = 0;
  let hi = events.length - 1;
  let best = events.length - 1; // default: cursor is after last event → last index
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
