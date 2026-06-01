/**
 * useSleepInhibitor
 *
 * Holds a platform sleep inhibitor (macOS IOPMAssertion / Windows
 * SetThreadExecutionState) while:
 *   - the `general.preventSleepWhileRunning` setting is enabled, AND
 *   - at least one session is in a "working" status.
 *
 * Releases the inhibitor when either condition flips false, and on unmount.
 * The Rust commands are idempotent, so duplicate calls are safe.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import { preventSleepWhileRunningAtom } from "@src/store/platform/preventSleepAtom";
import { anySessionWorkingAtom } from "@src/store/session/sessionAtom/atoms";

const logger = createLogger("SleepInhibitor");

const ACQUIRE_CMD = "system_power_acquire_sleep_inhibitor";
const RELEASE_CMD = "system_power_release_sleep_inhibitor";

/**
 * Pure decision function for the sleep-inhibitor lifecycle.
 *
 * Extracted from the hook so the acquire/release logic can be unit-tested
 * without a React renderer. Given the previous held state and the current
 * (enabled, working) inputs, returns the action to take and the next
 * held-state.
 *
 * Contract:
 *  - Acquire iff `enabled && working && !prevHeld`.
 *  - Release iff `!shouldHold && prevHeld`.
 *  - Otherwise no-op (already in the desired state).
 */
export type InhibitorAction = "acquire" | "release" | "noop";

export function computeInhibitorAction(
  prevHeld: boolean,
  enabled: boolean,
  working: boolean
): { action: InhibitorAction; nextHeld: boolean } {
  const shouldHold = enabled && working;
  if (shouldHold && !prevHeld) {
    return { action: "acquire", nextHeld: true };
  }
  if (!shouldHold && prevHeld) {
    return { action: "release", nextHeld: false };
  }
  return { action: "noop", nextHeld: prevHeld };
}

export function useSleepInhibitor(): void {
  const enabled = useAtomValue(preventSleepWhileRunningAtom);
  const working = useAtomValue(anySessionWorkingAtom);

  // Track whether *we* believe the assertion is held, so we don't fire
  // a redundant release on every render.
  const heldRef = useRef(false);

  useEffect(() => {
    const { action, nextHeld } = computeInhibitorAction(
      heldRef.current,
      enabled,
      working
    );

    if (action === "noop") return;

    heldRef.current = nextHeld;

    if (action === "acquire") {
      invoke(ACQUIRE_CMD).catch((err) => {
        // Roll back our local belief so a retry can fire on the next render.
        heldRef.current = false;
        logger.warn("acquire failed:", err);
      });
    } else {
      invoke(RELEASE_CMD).catch((err) => {
        logger.warn("release failed:", err);
      });
    }
  }, [enabled, working]);

  // Release on unmount (e.g. window close). The Rust state is process-wide so
  // a stale assertion would otherwise survive until process exit.
  useEffect(() => {
    return () => {
      if (heldRef.current) {
        heldRef.current = false;
        invoke(RELEASE_CMD).catch((err) => {
          logger.warn("release on unmount failed:", err);
        });
      }
    };
  }, []);
}
