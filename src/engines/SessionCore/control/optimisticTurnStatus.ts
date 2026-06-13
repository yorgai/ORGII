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
 * Optimistically mark the session as running so the planning indicator
 * starts immediately. Rust overwrites this the moment a real status event
 * lands. Call BEFORE the first event-store mutation of the turn (see module
 * doc). Pair with `failOptimisticTurn` on IPC failure.
 */
export function beginOptimisticTurn(
  sessionId: string,
  source: SessionRuntimeStatusSource = "dispatch"
): void {
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
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId,
    status: "idle",
    source,
  });
}
