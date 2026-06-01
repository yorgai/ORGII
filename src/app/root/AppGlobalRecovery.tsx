/**
 * AppGlobalRecovery
 *
 * Watchdog component that repairs stuck UI drag/resize state caused by
 * mouse-up events that fire outside the window (e.g. user releases the mouse
 * over a native OS element, DevTools, or another window).
 *
 * Stuck states detected:
 * - `document.body.classList` contains `resize-active`
 * - `document.body.style.cursor` is one of the STUCK_CURSORS set
 *
 * Recovery triggers (in order of priority):
 * 1. `mousemove` with no buttons held  → immediate reset
 * 2. `mouseup` / `pointerup`           → debounced reset (150 ms)
 * 3. `blur` (window loses focus)       → immediate reset
 * 4. `visibilitychange` → hidden       → immediate reset
 *
 * The 150 ms debounce on mouseup/pointerup prevents flicker when a legitimate
 * drag ends inside the window and React still needs one frame to clean up.
 */
import { useEffect } from "react";

const STUCK_CURSORS = new Set([
  "col-resize",
  "row-resize",
  "ew-resize",
  "ns-resize",
  "nwse-resize",
  "nesw-resize",
  "grabbing",
  "move",
  "crosshair",
]);

export function AppGlobalRecovery(): null {
  useEffect(() => {
    let cleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetStuckState = () => {
      document.body.classList.remove("resize-active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.querySelectorAll("iframe").forEach((iframe) => {
        (iframe as HTMLIFrameElement).style.pointerEvents = "";
      });
    };

    const hasStuckState = () =>
      document.body.classList.contains("resize-active") ||
      STUCK_CURSORS.has(document.body.style.cursor);

    const scheduleCleanup = () => {
      if (cleanupTimeoutId) {
        clearTimeout(cleanupTimeoutId);
      }
      cleanupTimeoutId = setTimeout(() => {
        if (hasStuckState()) {
          resetStuckState();
        }
      }, 150);
    };

    const immediateCleanup = () => {
      if (cleanupTimeoutId) {
        clearTimeout(cleanupTimeoutId);
        cleanupTimeoutId = null;
      }
      if (hasStuckState()) {
        resetStuckState();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && hasStuckState()) {
        immediateCleanup();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (event.buttons === 0 && hasStuckState()) {
        resetStuckState();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", scheduleCleanup);
    window.addEventListener("pointerup", scheduleCleanup);
    window.addEventListener("blur", immediateCleanup);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", scheduleCleanup);
      window.removeEventListener("pointerup", scheduleCleanup);
      window.removeEventListener("blur", immediateCleanup);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (cleanupTimeoutId) {
        clearTimeout(cleanupTimeoutId);
      }
    };
  }, []);

  return null;
}
