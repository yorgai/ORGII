/**
 * Optimistic turn status — single chokepoint for the "mark running before
 * the backend confirms" pattern used by every dispatch path.
 *
 * Why this exists: `usePlanningIndicator`'s cold-start path captures
 * `activationVersion` synchronously on the render where `isSessionActive`
 * first flips true. The optimistic `running` write MUST therefore land
 * BEFORE the first event-store mutation of the turn (e.g. appending the
 * synthetic user message): if the EventStore round-trip bumps `version`
 * first, the cold-start condition (`activationVersion === version`) breaks
 * and the planning footer is delayed by the full warm-path idle threshold.
 * This ordering invariant used to be re-commented at every call site; it is
 * documented once here and nowhere else.
 *
 * The write goes through `setSessionRuntimeStatusAtom`, which is gated to
 * the visible session — calling this for a background session is a safe
 * no-op (the global status mirror belongs to the session on screen).
 */
import {
  type SessionRuntimeStatusSource,
  setSessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

/**
 * Record of the session whose turn was most recently marked running
 * optimistically, with the epoch-ms timestamp of that write.
 *
 * The session-switch effect (`runSessionSwitchEffect` →
 * `resetSessionSwitchState`) fires synchronously after `setActiveSessionId`
 * and used to unconditionally reset the runtime status to `"idle"`. On the
 * launch path the optimistic `running` is written right after navigation, so
 * that reset erased it before the provider's first event re-asserted running.
 * On fast providers (Claude) the recovery event lands in ~tens of ms so the
 * gap was invisible; on slow ones (deepseek — long reasoning/TTFT) it was a
 * multi-second "frozen, no footer, Send-not-Stop" window.
 *
 * `resetSessionSwitchState` consults this marker (via
 * `wasRecentlyOptimisticallyStarted`) and skips the idle reset for the exact
 * session that was just optimistically started — without preserving a stale
 * `running` from a *different* (background) session, which is why the global
 * `sessionRuntimeStatusAtom` value alone cannot be trusted here.
 */
let recentOptimisticTurn: { sessionId: string; at: number } | null = null;

/** How long after an optimistic start the switch reset must defer to it. */
const RECENT_OPTIMISTIC_TURN_WINDOW_MS = 5_000;

/**
 * True when `sessionId` was optimistically marked running within the recent
 * window — i.e. a launch/dispatch is mid-flight for this exact session and the
 * switch effect must not reset it back to idle.
 */
export function wasRecentlyOptimisticallyStarted(sessionId: string): boolean {
  if (!recentOptimisticTurn) return false;
  if (recentOptimisticTurn.sessionId !== sessionId) return false;
  return (
    Date.now() - recentOptimisticTurn.at < RECENT_OPTIMISTIC_TURN_WINDOW_MS
  );
}

/**
 * Clear the recent-optimistic marker. Called once the switch reset has
 * honored it (or when a terminal/idle state is authoritatively reached) so a
 * later unrelated switch into the same session resets normally.
 */
export function clearRecentOptimisticTurn(sessionId: string): void {
  if (recentOptimisticTurn?.sessionId === sessionId) {
    recentOptimisticTurn = null;
  }
}

/**
 * Optimistically mark the session as running so the planning indicator
 * starts immediately. Rust overwrites this the moment a real status event
 * lands. Call BEFORE the first event-store mutation of the turn (see module
 * doc). Pair with `failOptimisticTurn` on IPC failure.
 */
export function beginOptimisticTurn(
  sessionId: string,
  source: SessionRuntimeStatusSource = "dispatch"
): void {
  recentOptimisticTurn = { sessionId, at: Date.now() };
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId,
    status: "running",
    source,
  });
}

/**
 * Roll back the optimistic `running` after the dispatch IPC failed before
 * the backend received the message — otherwise the UI stays stuck in the
 * optimistic running state with no terminal ever arriving.
 */
export function failOptimisticTurn(
  sessionId: string,
  source: SessionRuntimeStatusSource = "dispatch"
): void {
  clearRecentOptimisticTurn(sessionId);
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId,
    status: "idle",
    source,
  });
}
