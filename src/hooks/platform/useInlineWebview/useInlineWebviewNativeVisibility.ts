import { invoke } from "@tauri-apps/api/core";
import { type MutableRefObject, useEffect } from "react";

export interface UseInlineWebviewNativeVisibilityParams {
  isWebviewCreated: boolean;
  isVisible: boolean;
  isWebviewAvailable: boolean;
  labelRef: MutableRefObject<string>;
  updatePosition: (options?: { force?: boolean }) => Promise<void>;
  log: (...args: unknown[]) => void;
}

export function useInlineWebviewNativeVisibility(
  params: UseInlineWebviewNativeVisibilityParams
): void {
  const {
    isWebviewCreated,
    isVisible,
    isWebviewAvailable,
    labelRef,
    updatePosition,
    log,
  } = params;

  useEffect(() => {
    if (!isWebviewCreated || !isWebviewAvailable) return;

    let cancelled = false;

    const handleVisibility = async () => {
      try {
        if (isVisible) {
          log("Showing WebView (isVisible=true)");
          await updatePosition({ force: true });
          if (cancelled) return;
          await invoke("set_inline_webview_visibility", {
            label: labelRef.current,
            visible: true,
          });
        } else {
          log("Staging WebView offscreen (isVisible=false, but still mounted)");
          await invoke("update_inline_webview_position", {
            label: labelRef.current,
            x: -10000,
            y: -10000,
            width: 1,
            height: 1,
          });
        }
      } catch (err) {
        if (!cancelled) {
          log("Visibility change failed:", err);
        }
      }
    };

    void handleVisibility();

    return () => {
      cancelled = true;
    };
  }, [
    isWebviewCreated,
    isVisible,
    isWebviewAvailable,
    labelRef,
    updatePosition,
    log,
  ]);
}
