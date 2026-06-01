/**
 * useAgentWorkingRef — read-only ref for isAgentWorking that doesn't trigger re-renders.
 *
 * Problem: the old isAgentWorkingDerivedAtom depended on eventsAtom. Reading it via
 * useAtomValue() causes the entire consumer subtree to re-render on every
 * streaming delta, even when the value is only needed as a ref (e.g., for
 * Virtuoso's followOutput callback that runs outside React's render cycle).
 *
 * Solution: derive the boolean directly from EventStore via
 * useEventStoreSelector (idle-throttled during streaming), and combine it
 * with isSessionActiveAtom (Rust-pushed runtime status). The result is
 * synced into a ref — no re-renders.
 *
 * This is the "colocated subscription" pattern: the leaf consumer subscribes
 * directly to the data source instead of receiving it as a prop through
 * intermediate components.
 */
import { useAtomValue } from "jotai";
import { type MutableRefObject, useLayoutEffect, useRef } from "react";

import { useEventStoreSelector } from "@src/engines/SessionCore/core/store/hooks";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isSessionActiveAtom } from "@src/store/session/cliSessionStatusAtom";
import { isTerminalStatus } from "@src/types/session/session";

const TERMINAL_ACTION_TYPES = new Set(["session_end", "error"]);

function deriveIsWorking(events: ReadonlyArray<SessionEvent>): {
  eventSignal: boolean | null;
  terminalAction: boolean;
} {
  if (events.length === 0) return { eventSignal: null, terminalAction: false };
  const last = events[events.length - 1];
  if (TERMINAL_ACTION_TYPES.has(last.actionType)) {
    return { eventSignal: false, terminalAction: true };
  }
  if (isTerminalStatus(last.displayStatus)) {
    return { eventSignal: false, terminalAction: false };
  }
  return { eventSignal: true, terminalAction: false };
}

function deriveIsWorkingEqual(
  prev: { eventSignal: boolean | null; terminalAction: boolean },
  next: { eventSignal: boolean | null; terminalAction: boolean }
): boolean {
  return (
    prev.eventSignal === next.eventSignal &&
    prev.terminalAction === next.terminalAction
  );
}

/**
 * Returns a ref whose `.current` tracks the agent working state.
 * Does NOT cause re-renders when the value changes.
 *
 * Use this instead of `useAtomValue(isSessionActiveAtom)` when
 * you only need the value in a ref (for callbacks, Virtuoso, etc.).
 */
export function useAgentWorkingRef(): MutableRefObject<boolean> {
  const isSessionActive = useAtomValue(isSessionActiveAtom);
  const { eventSignal, terminalAction } = useEventStoreSelector(
    deriveIsWorking,
    deriveIsWorkingEqual
  );
  const ref = useRef(false);

  // Priority order:
  // 1. No events → trust isSessionActive
  // 2. Terminal action (session_end/error) → always false (overrides active)
  // 3. isSessionActive true → true (overrides terminal display status)
  // 4. Terminal display status → false
  // 5. Otherwise → true
  let resolved: boolean;
  if (eventSignal === null) {
    resolved = isSessionActive;
  } else if (terminalAction) {
    resolved = false;
  } else if (isSessionActive) {
    resolved = true;
  } else {
    resolved = eventSignal;
  }

  useLayoutEffect(() => {
    ref.current = resolved;
  }, [resolved]);

  return ref;
}
