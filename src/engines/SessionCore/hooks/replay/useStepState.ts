/**
 * useStepState Hook
 *
 * Provides session event data and step-related UI state.
 * Uses session store atoms directly.
 */
import { useAtom } from "jotai";
import { type Dispatch, type SetStateAction, useState } from "react";

import { eventsAtom } from "../../core/atoms";
import type { SessionEvent } from "../../core/types";

// ============================================
// Types
// ============================================

export interface UseStepStateReturn {
  // Events from session store (SessionEvent[] - no conversion!)
  events: SessionEvent[];
  setEvents: Dispatch<SetStateAction<SessionEvent[]>>;

  // Step-related UI state
  isStepWaiting: boolean;
  setIsStepWaiting: Dispatch<SetStateAction<boolean>>;
  stepPause: boolean;
  setStepPause: Dispatch<SetStateAction<boolean>>;
}

// ============================================
// Hook Implementation
// ============================================

export function useStepState(): UseStepStateReturn {
  const [events, setEvents] = useAtom(eventsAtom);

  // Step UI state (shared via hook instances)
  const [isStepWaiting, setIsStepWaiting] = useState<boolean>(false);
  const [stepPause, setStepPause] = useState<boolean>(false);

  return {
    events,
    setEvents,
    isStepWaiting,
    setIsStepWaiting,
    stepPause,
    setStepPause,
  };
}
