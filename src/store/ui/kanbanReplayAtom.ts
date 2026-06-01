/**
 * Kanban Replay state.
 *
 * Drives a music-player-style time cursor that the Kanban / Canvas views
 * scrub against. The cursor is purely a time selector; the actual
 * "tasks at cursor" transform lives in `useKanbanTasks` so both views
 * receive the same time-warped task list and stay in sync.
 *
 * Mode model mirrors `replayModeAtom` in SessionCore:
 *   - "follow": cursor = `bounds.end` (live), board updates as new
 *               sessions arrive.
 *   - "replay": cursor frozen at the user-picked timestamp.
 *
 * The bar's `[start, end]` window is written from `TaskKanban` based on
 * the active time-filter pill (1h / 6h / 12h / 24h / 3d). The cursor is
 * stored as an absolute unix-ms timestamp so it survives bounds rescales
 * (we just clamp it back into range when the window shrinks).
 *
 * No persistence: cursor + mode are in-memory only. Reload returns the
 * user to follow mode, which is the desirable default for a board.
 */
import { atom } from "jotai";

import type { KanbanTask } from "@src/features/KanbanBoard/types";

export type KanbanReplayMode = "follow" | "replay";

/** Absolute unix-ms cursor. `null` ⇔ follow mode (track `bounds.end`). */
export const kanbanReplayCursorAtom = atom<number | null>(null);
kanbanReplayCursorAtom.debugLabel = "kanban/replayCursor";

export const kanbanReplayModeAtom = atom<KanbanReplayMode>("follow");
kanbanReplayModeAtom.debugLabel = "kanban/replayMode";

/** [start, end] window in unix-ms. Written by `useKanbanTasks` from the
 *  active time-filter pill; read by `KanbanReplayBar`. */
export const kanbanReplayBoundsAtom = atom<{ start: number; end: number }>({
  start: 0,
  end: 0,
});
kanbanReplayBoundsAtom.debugLabel = "kanban/replayBounds";

// ── Event timeline ──────────────────────────────────────────────────
// A "kanban event" here is a per-task milestone — `created` when the
// session was spawned, `terminal` when it reached a terminal status.
// Routine tasks have no real timestamps and are excluded.

export interface KanbanReplayEvent {
  /** Stable id: `${task.id}:created` or `${task.id}:terminal`. */
  id: string;
  ts: number;
  kind: "created" | "terminal";
  task: KanbanTask;
}

/** Events sourced from the unfiltered task list. Written from
 *  `useKanbanTasks` so the bar doesn't need to re-derive timestamps. */
export const kanbanReplayEventsAtom = atom<KanbanReplayEvent[]>([]);
kanbanReplayEventsAtom.debugLabel = "kanban/replayEvents";

export const kanbanReplayEventCountAtom = atom(
  (get) => get(kanbanReplayEventsAtom).length
);
kanbanReplayEventCountAtom.debugLabel = "kanban/replayEventCount";

/** Resolved cursor — `null` resolves to `bounds.end` (follow mode). */
export const resolvedKanbanCursorAtom = atom((get) => {
  const cursor = get(kanbanReplayCursorAtom);
  if (cursor !== null) return cursor;
  return get(kanbanReplayBoundsAtom).end;
});
resolvedKanbanCursorAtom.debugLabel = "kanban/resolvedCursor";

/**
 * Index of the latest event whose timestamp is `<= cursor`. Returns -1
 * if the cursor sits before the first event. Drives the slider position
 * and the "5 nearest events" marker dot logic.
 */
export const currentKanbanReplayEventIndexAtom = atom((get) => {
  const events = get(kanbanReplayEventsAtom);
  if (events.length === 0) return -1;
  const cursor = get(resolvedKanbanCursorAtom);
  let lo = 0;
  let hi = events.length - 1;
  let result = -1;
  // Binary search for the rightmost ts <= cursor.
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].ts <= cursor) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
});
currentKanbanReplayEventIndexAtom.debugLabel = "kanban/currentReplayEventIndex";

/**
 * Write-only navigation atom — same shape as
 * `navigateToSimulatorEventByIndexAtom`. Selecting an index parks the
 * cursor at that event's timestamp and switches to replay mode.
 *
 * Special case: index >= count - 1 returns to follow mode (cursor =
 * null), matching the simulator bar's snap-to-end behaviour.
 */
export const navigateKanbanCursorByIndexAtom = atom(
  null,
  (get, set, targetIndex: number) => {
    const events = get(kanbanReplayEventsAtom);
    if (events.length === 0) return;
    const clamped = Math.max(0, Math.min(events.length - 1, targetIndex));
    if (clamped >= events.length - 1) {
      set(kanbanReplayCursorAtom, null);
      set(kanbanReplayModeAtom, "follow");
      return;
    }
    set(kanbanReplayCursorAtom, events[clamped].ts);
    set(kanbanReplayModeAtom, "replay");
  }
);
navigateKanbanCursorByIndexAtom.debugLabel = "kanban/navigateCursorByIndex";

/**
 * Write-only: park the cursor at an arbitrary timestamp (used by the
 * slider's smooth scrubbing, where we don't want to snap to discrete
 * events while dragging).
 */
export const setKanbanCursorTimestampAtom = atom(
  null,
  (get, set, ts: number) => {
    const { start, end } = get(kanbanReplayBoundsAtom);
    if (end <= start) return;
    const clamped = Math.max(start, Math.min(end, ts));
    set(kanbanReplayCursorAtom, clamped);
    set(kanbanReplayModeAtom, "replay");
  }
);
setKanbanCursorTimestampAtom.debugLabel = "kanban/setCursorTimestamp";

/**
 * Step the cursor to the previous discrete event (chronological).
 * Same UX as `navigatePrevSimulatorEventAtom` in the simulator pill —
 * if the cursor isn't aligned to an event, falls back to the last
 * event so a fresh entry into replay still does something useful.
 */
export const navigatePrevKanbanEventAtom = atom(null, (get, set) => {
  const events = get(kanbanReplayEventsAtom);
  if (events.length === 0) return;
  const currentIdx = get(currentKanbanReplayEventIndexAtom);
  if (currentIdx < 0) {
    set(navigateKanbanCursorByIndexAtom, events.length - 1);
    return;
  }
  if (currentIdx <= 0) return;
  set(navigateKanbanCursorByIndexAtom, currentIdx - 1);
});
navigatePrevKanbanEventAtom.debugLabel = "kanban/navigatePrevEvent";

/**
 * Step the cursor to the next discrete event (chronological). Mirrors
 * `navigateNextSimulatorEventAtom`.
 */
export const navigateNextKanbanEventAtom = atom(null, (get, set) => {
  const events = get(kanbanReplayEventsAtom);
  if (events.length === 0) return;
  const currentIdx = get(currentKanbanReplayEventIndexAtom);
  if (currentIdx < 0) {
    set(navigateKanbanCursorByIndexAtom, 0);
    return;
  }
  if (currentIdx >= events.length - 1) return;
  set(navigateKanbanCursorByIndexAtom, currentIdx + 1);
});
navigateNextKanbanEventAtom.debugLabel = "kanban/navigateNextEvent";

/**
 * Whether the kanban replay is currently auto-stepping. Same role as
 * `simulatorSessionPlaybackPlayingAtom`. Driven by the play/pause
 * button on the status pill; the autoplay timer lives in the pill
 * component itself.
 */
export const kanbanReplayPlayingAtom = atom<boolean>(false);
kanbanReplayPlayingAtom.debugLabel = "kanban/replayPlaying";

/**
 * Playback-speed multiplier (1 / 2 / 4 / etc) used by the autoplay
 * timer. Mirrors `simulatorPlaybackSpeedAtom`.
 */
export const kanbanReplaySpeedAtom = atom<number>(1);
kanbanReplaySpeedAtom.debugLabel = "kanban/replaySpeed";
