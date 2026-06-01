/**
 * useAutoTimeout Hook
 *
 * Countdown timer that fires a callback when it reaches zero.
 * Used by AskQuestionCard (auto-skip) and PlanCard (auto-execute)
 * to implement configurable timeout behavior.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAutoTimeoutOptions {
  /** Timeout in seconds (0 = disabled) */
  timeoutSeconds: number;
  /** Whether the countdown is currently active */
  enabled: boolean;
  /** Called when the countdown reaches zero */
  onTimeout: () => void;
}

export interface UseAutoTimeoutReturn {
  /** Remaining seconds (null when disabled or not running) */
  remaining: number | null;
  /** Cancel the current countdown */
  cancel: () => void;
}

export function useAutoTimeout({
  timeoutSeconds,
  enabled,
  onTimeout,
}: UseAutoTimeoutOptions): UseAutoTimeoutReturn {
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(0);
  const onTimeoutRef = useRef(onTimeout);
  const cancelledRef = useRef(false);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopInterval();
    setRemaining(null);
  }, [stopInterval]);

  useEffect(() => {
    if (!enabled || timeoutSeconds <= 0) {
      cancelledRef.current = true;
      stopInterval();
      return;
    }

    cancelledRef.current = false;
    remainingRef.current = timeoutSeconds;

    const initTimer = setTimeout(() => {
      if (!cancelledRef.current) setRemaining(timeoutSeconds);
    }, 0);

    intervalRef.current = setInterval(() => {
      if (cancelledRef.current) return;
      remainingRef.current -= 1;
      if (remainingRef.current <= 0) {
        stopInterval();
        setRemaining(null);
        if (!cancelledRef.current) {
          onTimeoutRef.current();
        }
      } else {
        setRemaining(remainingRef.current);
      }
    }, 1000);

    return () => {
      cancelledRef.current = true;
      clearTimeout(initTimer);
      stopInterval();
    };
  }, [enabled, timeoutSeconds, stopInterval]);

  // When disabled, always null regardless of stale state
  const effectiveRemaining = !enabled || timeoutSeconds <= 0 ? null : remaining;

  return { remaining: effectiveRemaining, cancel };
}
