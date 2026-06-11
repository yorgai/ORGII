/**
 * Types for useCellReplayState and related hooks.
 */
import type { SessionEvent } from "@src/engines/SessionCore";

/**
 * Explicit replay mode for a cell.
 *
 *  - `follow`   — live tail. New events advance the cursor. Used when the cell
 *                 has no external cursor and the user has not interacted.
 *  - `synced`   — cursor slaved to the main replay cursor (`externalCursorMs`).
 *                 New events do not move the cursor; the cursor only moves
 *                 when the external cursor moves.
 *  - `detached` — user owns the cursor (after scrub / step / play). New events
 *                 NEVER touch the cursor; the external cursor is ignored.
 *                 The `syncToMain` control returns to `synced` or `follow`.
 *
 * The "scrub" interaction is NOT a mode — it's a transient session opened with
 * `beginScrub()` / `endScrub()` while a mode is active. While a scrub session
 * is open, all external writes are queued; the final committed value goes
 * through the single persisted setter.
 */
export type ReplayMode = "follow" | "synced" | "detached";

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
  /** Current replay mode (see `ReplayMode`). */
  mode: ReplayMode;
  /**
   * Convenience flag: `true` when the user has detached this cell from the
   * shared timeline (mode === "detached"). Kept for existing UI consumers.
   */
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
  /** Re-attach this cell to the shared timeline (clears detach). */
  syncToMain: () => void;
  /**
   * Open a scrub session. While open, the displayed cursor follows
   * `scrub(index)` calls instantly without committing to persistence, and
   * external writes (event growth, external cursor) cannot move the cursor.
   * `endScrub` commits the final index exactly once through the persisted
   * setter and transitions to `detached` mode.
   */
  beginScrub: () => void;
  scrub: (index: number) => void;
  endScrub: (index: number) => void;
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
   * External replay cursor in epoch ms. When non-null and the cell is in
   * `synced` mode, the cell shows the event whose `createdAt`/`lastActivityAt`
   * is closest to (but not after) this timestamp.
   */
  externalCursorMs?: number | null;
}

export interface UseCellReplayStateReturn {
  state: CellReplayState;
  controls: CellReplayControls;
}
