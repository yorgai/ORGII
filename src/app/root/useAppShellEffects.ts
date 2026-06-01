/**
 * useAppShellEffects
 *
 * Applies global CSS variables and HTML-element class toggles that reflect
 * user appearance settings stored in Jotai atoms. Each effect is independent
 * and cleans up its own DOM mutations on unmount.
 *
 * Managed properties:
 * - CSS zoom + `--ui-scale`                                  (uiScaleAtom, 0–200 %)
 * - `--app-font-family`                                    (applicationUiFontAtom)
 * - `html.fullscreen` class                                (windowFullscreenAtom)
 *
 * This hook must run in AppBootstrap (before first render) so the styles are
 * applied before any child component paints, avoiding a flash of unstyled UI.
 */
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { getApplicationUiFontStack } from "@src/config/appearance/applicationUiFonts";
import {
  applicationUiFontAtom,
  uiScaleAtom,
  windowFullscreenAtom,
} from "@src/store/ui/uiAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";

export function useAppShellEffects(): void {
  const uiScale = useAtomValue(uiScaleAtom);
  const applicationUiFont = useAtomValue(applicationUiFontAtom);
  const isFullscreen = useAtomValue(windowFullscreenAtom);

  useEffect(() => {
    const root = document.documentElement;
    const scaleValue = uiScale / 100;

    root.style.zoom = String(scaleValue);
    root.style.setProperty("--ui-scale", String(scaleValue));
    invokeTauri("set_main_webview_zoom", { scaleFactor: 1 }).catch((error) => {
      console.error("[UI Scale] Failed to reset native WebView zoom:", error);
    });
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("orgii-ui-scale-applied"));
    });

    return () => {
      root.style.zoom = "";
      root.style.removeProperty("--ui-scale");
    };
  }, [uiScale]);

  useEffect(() => {
    const root = document.documentElement;
    const stack = getApplicationUiFontStack(applicationUiFont);
    root.style.setProperty("--app-font-family", stack);
    return () => {
      root.style.removeProperty("--app-font-family");
    };
  }, [applicationUiFont]);

  useEffect(() => {
    const htmlElement = document.documentElement;
    if (isFullscreen) {
      htmlElement.classList.add("fullscreen");
    } else {
      htmlElement.classList.remove("fullscreen");
    }
  }, [isFullscreen]);
}
