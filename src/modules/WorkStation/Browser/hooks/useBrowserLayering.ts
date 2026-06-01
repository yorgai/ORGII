/**
 * useBrowserLayering
 *
 * Controls the native z-order of an inline Browser WKWebView relative to
 * the main React webview (macOS only). On macOS, Tauri child webviews are
 * sibling NSViews of the window's contentView, and subview order
 * determines both rendering order and mouse-event routing.
 *
 * By default, the Browser webview sits in front so clicks reach the page
 * normally. When React needs to render an overlay UI that visually crosses
 * the Browser's rect — a URL-bar dropdown, tooltip, history popover, or
 * modal — call `sendToBack` to drop the Browser beneath the React surface
 * so the overlay draws on top. Call `bringToFront` when the overlay closes.
 *
 * Design discussion: we never leave the Browser behind indefinitely. Doing
 * so would route clicks in its rect to the transparent React surface
 * above, which is not what the user wants. Persistent sidebars should
 * instead shrink the Browser rect via `update_inline_webview_position`.
 *
 * ## Example
 *
 * ```tsx
 * const { overlay } = useBrowserLayering({
 *   webviewLabel: `browser-session-${sessionId}`,
 * });
 *
 * async function openHistoryMenu() {
 *   const release = await overlay();
 *   const result = await showHistoryMenu();
 *   release(); // Browser returns to front, clicks reach the page again.
 *   return result;
 * }
 * ```
 */
import { useCallback, useEffect, useRef } from "react";

import { invokeTauri } from "@src/util/platform/tauri/init";

export interface UseBrowserLayeringOptions {
  /** Inline webview label, e.g. `browser-session-${sessionId}`. */
  webviewLabel: string | null | undefined;
}

export interface UseBrowserLayeringReturn {
  /** Move the webview behind React siblings (call when opening an overlay). */
  sendToBack: () => Promise<void>;
  /** Restore the webview to the top of the sibling stack (default). */
  bringToFront: () => Promise<void>;
  /**
   * Convenience: scoped send-to-back. Call on overlay open; the returned
   * function brings the webview back to front when the overlay closes.
   *
   *   const release = await overlay();
   *   // …user interacts with dropdown…
   *   release();
   */
  overlay: () => Promise<() => void>;
}

export function useBrowserLayering(
  options: UseBrowserLayeringOptions
): UseBrowserLayeringReturn {
  const { webviewLabel } = options;

  // Capture the latest label so the unmount cleanup effect can read it
  // without depending on `webviewLabel` (which would re-run cleanup on
  // every label change and undo the front-restore the next mount expects).
  const labelRef = useRef<string | null | undefined>(webviewLabel);
  useEffect(() => {
    labelRef.current = webviewLabel;
  }, [webviewLabel]);

  const sendToBack = useCallback(async () => {
    if (!webviewLabel) return;
    try {
      await invokeTauri<void>("browser_webview_send_to_back", {
        label: webviewLabel,
      });
    } catch (error) {
      console.warn("[useBrowserLayering] sendToBack failed:", error);
    }
  }, [webviewLabel]);

  const bringToFront = useCallback(async () => {
    if (!webviewLabel) return;
    try {
      await invokeTauri<void>("browser_webview_bring_to_front", {
        label: webviewLabel,
      });
    } catch (error) {
      console.warn("[useBrowserLayering] bringToFront failed:", error);
    }
  }, [webviewLabel]);

  const overlay = useCallback(async () => {
    await sendToBack();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      void bringToFront();
    };
  }, [sendToBack, bringToFront]);

  useEffect(() => {
    return () => {
      const label = labelRef.current;
      if (!label) return;
      void invokeTauri<void>("browser_webview_bring_to_front", { label }).catch(
        () => {}
      );
    };
  }, []);

  return { sendToBack, bringToFront, overlay };
}
