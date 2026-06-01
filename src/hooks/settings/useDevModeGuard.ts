import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

/**
 * Blocks the native WebView context menu (Inspect Element, Reload, etc.)
 * when Dev Mode is disabled. Attaches a global `contextmenu` listener
 * that calls preventDefault().
 */
export function useDevModeGuard() {
  const devModeEnabled = useAtomValue(devModeEnabledAtom);

  useEffect(() => {
    if (devModeEnabled) return;

    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", blockContextMenu, {
      capture: true,
    });

    return () => {
      document.removeEventListener("contextmenu", blockContextMenu, {
        capture: true,
      });
    };
  }, [devModeEnabled]);
}
