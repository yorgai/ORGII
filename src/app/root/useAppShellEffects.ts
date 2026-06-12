/**
 * useAppShellEffects
 *
 * Applies global CSS variables and HTML-element class toggles that reflect
 * user appearance settings stored in Jotai atoms. Each effect is independent
 * and cleans up its own DOM mutations on unmount.
 *
 * Managed properties:
 * - Native WebView scale + coordinate scale variables         (uiScaleAtom, 0–200 %)
 * - `--app-font-family`                                    (applicationUiFontAtom)
 * - `html.fullscreen` class                                (windowFullscreenAtom)
 *
 * This hook must run in AppBootstrap (before first render) so the styles are
 * applied before any child component paints, avoiding a flash of unstyled UI.
 */
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { getApplicationUiFontStack } from "@src/config/appearance/applicationUiFonts";
import { createLogger } from "@src/hooks/logger";
import {
  applicationUiFontAtom,
  uiScaleAtom,
  windowFullscreenAtom,
} from "@src/store/ui/uiAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";

const logger = createLogger("AppShellEffects");

export function useAppShellEffects(): void {
  const uiScale = useAtomValue(uiScaleAtom);
  const applicationUiFont = useAtomValue(applicationUiFontAtom);
  const isFullscreen = useAtomValue(windowFullscreenAtom);

  useEffect(() => {
    const root = document.documentElement;
    const appRoot = document.getElementById("root");
    const scaleValue = uiScale / 100;

    root.style.zoom = "";
    root.style.setProperty("--ui-scale", "1");
    root.style.setProperty("--native-frame-scale", String(scaleValue));
    invokeTauri("set_main_webview_zoom", { scaleFactor: scaleValue }).catch(
      (error) => {
        logger.error("failed to set native WebView zoom:", error);
      }
    );

    if (appRoot) {
      appRoot.style.transform = "";
      appRoot.style.transformOrigin = "";
      appRoot.style.width = "";
      appRoot.style.height = "";
    }

    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("orgii-ui-scale-applied"));
    });

    return () => {
      root.style.zoom = "";
      root.style.removeProperty("--ui-scale");
      root.style.removeProperty("--native-frame-scale");
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
