/**
 * Window Focus Tracking Hook
 *
 * Tracks window focus/blur events and notifies the backend for adaptive git polling.
 *
 * Polling frequency adjusts based on focus:
 * - Focused + recent changes: 3s (fast - reduced from 1.5s to prevent fd exhaustion)
 * - Focused + no changes: 5s (moderate)
 * - Not focused: 15s (slow)
 * - Idle 5+ min: 30s (very slow)
 *
 * Note: Each git status spawns 4-6 processes, so conservative intervals prevent
 * "Bad file descriptor" errors from too many concurrent git operations.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("WindowFocus");

export function useWindowFocusTracking() {
  useEffect(() => {
    async function handleFocus() {
      try {
        await invoke("set_window_focus", { focused: true });
      } catch (error) {
        log.error("[WindowFocus] Failed to set focused state:", error);
      }
    }

    async function handleBlur() {
      try {
        await invoke("set_window_focus", { focused: false });
      } catch (error) {
        log.error("[WindowFocus] Failed to set blur state:", error);
      }
    }

    // Track window focus/blur
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Also track visibility change (tab switching, minimizing)
    function handleVisibilityChange() {
      if (document.hidden) {
        handleBlur();
      } else {
        handleFocus();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Set initial state
    if (document.hasFocus() && !document.hidden) {
      handleFocus();
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
