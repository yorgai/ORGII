/**
 * useBrowserAutomation
 *
 * Hook that bridges Tauri events from the browser automation sidecar
 * to Jotai state. Listens for `browser:frame` and `browser:status`
 * events and dispatches them to the corresponding atoms.
 *
 * Also exposes imperative controls for start/stop/takeover/resume.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import {
  browserAutomationAtom,
  browserFrameEventAtom,
  browserStatusEventAtom,
  clearLiveScreenshotAtom,
  clearScreenshotCacheAtom,
  resetBrowserAutomationAtom,
} from "@src/store/workstation/browser/browserAutomationAtom";
import type {
  BrowserFrameEvent,
  BrowserStatusEvent,
} from "@src/store/workstation/browser/browserAutomationAtom";
import { invokeTauri, listenTauri } from "@src/util/platform/tauri/init";

/** Options for the useBrowserAutomation hook. */
export interface UseBrowserAutomationOptions {
  /** Whether to listen for events. Default: true. */
  enabled?: boolean;
}

/** Return value from useBrowserAutomation. */
export interface UseBrowserAutomationReturn {
  /** Current browser automation state. */
  status: "idle" | "starting" | "running" | "paused" | "error";
  /** Current page URL. */
  currentUrl: string;
  /** Last screenshot (base64 PNG). */
  lastScreenshot: string | null;
  /** Last action description. */
  lastAction: string | null;
  /** Whether the sidecar is running. */
  isRunning: boolean;
  /** Whether automation is paused for user takeover. */
  isPaused: boolean;
  /** Error message if any. */
  errorMessage: string | null;
  /** Start browser automation. */
  start: () => Promise<void>;
  /** Stop browser automation. */
  stop: () => Promise<void>;
  /** Pause agent and give user control of Chrome. */
  takeover: () => Promise<void>;
  /** Resume agent control after user takeover. */
  resume: () => Promise<string>;
}

export function useBrowserAutomation(
  options: UseBrowserAutomationOptions = {}
): UseBrowserAutomationReturn {
  const { enabled = true } = options;

  const state = useAtomValue(browserAutomationAtom);
  const dispatchFrame = useSetAtom(browserFrameEventAtom);
  const dispatchStatus = useSetAtom(browserStatusEventAtom);
  const clearLiveScreenshot = useSetAtom(clearLiveScreenshotAtom);
  const clearScreenshotCache = useSetAtom(clearScreenshotCacheAtom);
  const reset = useSetAtom(resetBrowserAutomationAtom);

  useEffect(() => {
    if (!enabled) {
      clearLiveScreenshot();
      clearScreenshotCache();
    }
  }, [clearLiveScreenshot, clearScreenshotCache, enabled]);

  // Listen for Tauri events
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      try {
        const unlistenFrame = await listenTauri<BrowserFrameEvent>(
          "browser:frame",
          (event) => {
            if (!cancelled) {
              dispatchFrame(event.payload);
            }
          }
        );
        if (!cancelled) unlisteners.push(unlistenFrame);

        const unlistenStatus = await listenTauri<BrowserStatusEvent>(
          "browser:status",
          (event) => {
            if (!cancelled) {
              dispatchStatus(event.payload);
            }
          }
        );
        if (!cancelled) unlisteners.push(unlistenStatus);
      } catch {
        // Tauri events may not be available in web dev mode
      }
    };

    setup();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [enabled, dispatchFrame, dispatchStatus]);

  // Imperative controls
  const start = useCallback(async () => {
    dispatchStatus({ status: "starting" });
    try {
      const result = await invokeTauri<{ running: boolean; port: number }>(
        "browser_automation_start"
      );
      dispatchStatus({ status: "running", port: result.port });
    } catch (err) {
      dispatchStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [dispatchStatus]);

  const stop = useCallback(async () => {
    try {
      await invokeTauri("browser_automation_stop");
      reset();
    } catch (err) {
      dispatchStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [reset, dispatchStatus]);

  const takeover = useCallback(async () => {
    try {
      await invokeTauri("browser_automation_takeover");
      dispatchStatus({ status: "paused" });
    } catch (err) {
      dispatchStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [dispatchStatus]);

  const resume = useCallback(async () => {
    try {
      const snapshot = await invokeTauri<string>("browser_automation_resume");
      dispatchStatus({ status: "running" });
      return snapshot;
    } catch (err) {
      dispatchStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return "";
    }
  }, [dispatchStatus]);

  return {
    status: state.status,
    currentUrl: state.currentUrl,
    lastScreenshot: state.lastScreenshot,
    lastAction: state.lastAction,
    isRunning: state.status === "running" || state.status === "paused",
    isPaused: state.status === "paused",
    errorMessage: state.errorMessage,
    start,
    stop,
    takeover,
    resume,
  };
}
