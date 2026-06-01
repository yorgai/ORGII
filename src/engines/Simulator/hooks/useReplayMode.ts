/**
 * useReplayMode Hook
 *
 * Tracks whether the user is actively using the replay bar.
 * Prevents auto-follow when user is manually navigating events.
 *
 * Features:
 * - Detect when user drags replay bar away from end
 * - Auto-reset to follow mode after timeout
 * - Configurable thresholds from REPLAY_CONFIG
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";

// ============================================
// Types
// ============================================

export interface UseReplayModeOptions {
  /** Current replay bar value */
  replayBarValue: number | number[];
}

export interface UseReplayModeReturn {
  /** Whether user is actively replaying (not at end) */
  isUserReplaying: boolean;
  /** Check if currently in replay mode */
  checkIsReplaying: () => boolean;
}

// ============================================
// Hook Implementation
// ============================================

export function useReplayMode(
  options: UseReplayModeOptions
): UseReplayModeReturn {
  const { replayBarValue } = options;

  // Track if user is actively using replay bar
  // State for render-time access, ref for synchronous callback access
  const [isUserReplaying, setIsUserReplaying] = useState(false);
  const isUserReplayingRef = useRef(false);
  const replayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous bar value for change detection
  const [prevBarValue, setPrevBarValue] = useState(replayBarValue);

  // Compute if we're at the end based on current bar value
  const { MAX_VALUE, AT_END_THRESHOLD, REPLAY_MODE_TIMEOUT } = REPLAY_CONFIG;
  const currentValue = Array.isArray(replayBarValue)
    ? replayBarValue[0]
    : replayBarValue;
  const isAtEnd = currentValue >= MAX_VALUE - AT_END_THRESHOLD;

  // React documented pattern: setState during render when prop changes
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // Note: We only update state during render, not refs (refs are synced in effect below)
  if (replayBarValue !== prevBarValue) {
    setPrevBarValue(replayBarValue);

    if (!isAtEnd && !isUserReplaying) {
      setIsUserReplaying(true);
    } else if (isAtEnd && isUserReplaying) {
      setIsUserReplaying(false);
    }
  }

  // Sync ref with state (refs cannot be updated during render)
  useEffect(() => {
    isUserReplayingRef.current = isUserReplaying;
  }, [isUserReplaying]);

  // Handle timeout for auto-reset (uses effect since setTimeout is external system)
  useEffect(() => {
    // Clear any existing timeout
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current);
      replayTimeoutRef.current = null;
    }

    if (!isAtEnd && isUserReplaying) {
      // Reset after timeout of no interaction
      replayTimeoutRef.current = setTimeout(() => {
        isUserReplayingRef.current = false;
        setIsUserReplaying(false);
      }, REPLAY_MODE_TIMEOUT);
    }

    // Cleanup timeout on unmount
    return () => {
      if (replayTimeoutRef.current) {
        clearTimeout(replayTimeoutRef.current);
      }
    };
  }, [isAtEnd, isUserReplaying, REPLAY_MODE_TIMEOUT]);

  // Getter for current replay state (uses ref for synchronous access in callbacks)
  const checkIsReplaying = useCallback(() => {
    return isUserReplayingRef.current;
  }, []);

  return {
    isUserReplaying,
    checkIsReplaying,
  };
}

export default useReplayMode;
