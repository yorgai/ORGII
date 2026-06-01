import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { type MutableRefObject, useEffect, useRef } from "react";

export interface UseWebviewNewWindowListenerParams {
  isWebviewAvailable: boolean;
  labelRef: MutableRefObject<string>;
  log: (...args: unknown[]) => void;
  newWindowListenerRef: MutableRefObject<UnlistenFn | null>;
  onNewWindow?: (url: string) => void;
}

export function useWebviewNewWindowListener(
  params: UseWebviewNewWindowListenerParams
): void {
  const {
    isWebviewAvailable,
    labelRef,
    log,
    newWindowListenerRef,
    onNewWindow,
  } = params;

  const onNewWindowRef = useRef(onNewWindow);

  useEffect(() => {
    onNewWindowRef.current = onNewWindow;
  }, [onNewWindow]);

  useEffect(() => {
    if (!isWebviewAvailable) return;

    let effectActive = true;
    let cleanupCalled = false;
    let unlisten: UnlistenFn | null = null;

    const localSafeUnlisten = (fn: UnlistenFn | null) => {
      if (!fn) return;
      setTimeout(() => {
        try {
          fn();
        } catch {
          // Tauri may have already removed the listener
        }
      }, 0);
    };

    const setupListener = async () => {
      try {
        const unlistenFn = await listen<{ url: string; webviewLabel: string }>(
          "webview-new-window-request",
          (event) => {
            if (!effectActive) return;
            if (event.payload.webviewLabel === labelRef.current) {
              log("New window request received:", event.payload.url);
              onNewWindowRef.current?.(event.payload.url);
            }
          }
        );

        if (effectActive) {
          unlisten = unlistenFn;
          newWindowListenerRef.current = unlistenFn;
        } else {
          localSafeUnlisten(unlistenFn);
        }
      } catch (err) {
        log("Failed to set up new window listener:", err);
      }
    };

    void setupListener();

    return () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      effectActive = false;

      localSafeUnlisten(unlisten);
      if (
        newWindowListenerRef.current &&
        newWindowListenerRef.current !== unlisten
      ) {
        localSafeUnlisten(newWindowListenerRef.current);
      }
      newWindowListenerRef.current = null;
    };
  }, [isWebviewAvailable, labelRef, log, newWindowListenerRef]);
}
