/**
 * useGlobalBrowserWebviewLayering
 *
 * Single-mount bridge between React overlay state (`activeOverlayCountAtom`)
 * and the native z-order of every inline Browser WKWebView. Mount once at
 * the app root. When any overlay opens anywhere in the app, all inline
 * browser webviews drop behind the React UI so portals (dropdowns, modals,
 * spotlights, tooltips) paint and receive clicks correctly. When the last
 * overlay closes, the webviews return to the front.
 *
 * No call-site changes are needed in individual overlay components — the
 * overlay primitives themselves (`useDropdownEngine`, `SpotlightPortal`,
 * `Tooltip`) contribute to the count via `useOverlayLayer`.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { createLogger } from "@src/hooks/logger";
import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import { isMacOS } from "@src/util/platform/tauri";
import { invokeTauri } from "@src/util/platform/tauri/init";

const log = createLogger("useGlobalBrowserWebviewLayering");

export function useGlobalBrowserWebviewLayering(): void {
  const count = useAtomValue(activeOverlayCountAtom);
  const lastStateRef = useRef<"front" | "back" | null>(null);

  useEffect(() => {
    if (!isMacOS()) return;

    const shouldBeBack = count > 0;
    const next = shouldBeBack ? "back" : "front";
    if (lastStateRef.current === next) return;
    lastStateRef.current = next;

    void invokeTauri<string[]>("browser_webviews_set_layer_for_all", {
      sendToBack: shouldBeBack,
    }).catch((error) => {
      log.warn("[useGlobalBrowserWebviewLayering] reorder failed:", error);
    });
  }, [count]);
}
