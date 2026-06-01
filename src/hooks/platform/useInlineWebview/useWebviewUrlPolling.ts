import { invoke } from "@tauri-apps/api/core";
import { type MutableRefObject, useCallback, useEffect } from "react";

export interface UseWebviewUrlPollingParams {
  isWebviewCreated: boolean;
  isVisible: boolean;
  pollInterval: number;
  labelRef: MutableRefObject<string>;
  isDestroyedRef: MutableRefObject<boolean>;
  isUnmountedRef: MutableRefObject<boolean>;
  pollIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  lastPolledUrlRef: MutableRefObject<string>;
  setCurrentUrl: (url: string) => void;
  onNavigate?: (url: string) => void;
  log: (...args: unknown[]) => void;
}

export function useWebviewUrlPolling(
  params: UseWebviewUrlPollingParams
): () => Promise<void> {
  const {
    isWebviewCreated,
    isVisible,
    pollInterval,
    labelRef,
    isDestroyedRef,
    isUnmountedRef,
    pollIntervalRef,
    lastPolledUrlRef,
    setCurrentUrl,
    onNavigate,
    log,
  } = params;

  const pollUrl = useCallback(async () => {
    if (!isWebviewCreated || isDestroyedRef.current || isUnmountedRef.current)
      return;

    try {
      const result = await invoke<string | null>("get_webview_url", {
        label: labelRef.current,
      });

      // Re-check after the async invoke — component may have unmounted
      if (isUnmountedRef.current || isDestroyedRef.current) return;

      if (result && result !== lastPolledUrlRef.current) {
        log("URL change detected via polling:", result);
        lastPolledUrlRef.current = result;
        setCurrentUrl(result);
        onNavigate?.(result);
      }
    } catch (err) {
      log("Poll error (may be expected):", err);
    }
  }, [
    isWebviewCreated,
    isDestroyedRef,
    isUnmountedRef,
    labelRef,
    lastPolledUrlRef,
    log,
    onNavigate,
    setCurrentUrl,
  ]);

  useEffect(() => {
    if (!isWebviewCreated || !isVisible || pollInterval <= 0) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const INITIAL_POLL_DELAY = 500;
    log(
      "Starting URL polling with interval:",
      pollInterval,
      "after delay:",
      INITIAL_POLL_DELAY
    );

    const startupTimer = setTimeout(() => {
      void pollUrl();
      pollIntervalRef.current = setInterval(() => {
        void pollUrl();
      }, pollInterval);
    }, INITIAL_POLL_DELAY);

    return () => {
      clearTimeout(startupTimer);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [
    isWebviewCreated,
    isVisible,
    pollInterval,
    log,
    pollIntervalRef,
    pollUrl,
  ]);

  return pollUrl;
}
