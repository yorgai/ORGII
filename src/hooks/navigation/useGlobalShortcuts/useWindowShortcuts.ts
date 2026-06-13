import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";
import {
  holdToQuitOverlayOpenAtom,
  isAppQuittingAtom,
} from "@src/store/ui/overlayAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isTauriDesktop } from "@src/util/platform/tauri";

const logger = createLogger("WindowShortcuts");

const HOLD_TO_QUIT_MS = 1000;

let quitInProgress = false;
let holdToQuitTimer: ReturnType<typeof setTimeout> | null = null;

export function useWindowShortcuts() {
  const handleQuit = useCallback(async () => {
    if (!isTauriDesktop() || quitInProgress) return;

    quitInProgress = true;

    try {
      const jotaiStore = getInstrumentedStore();
      jotaiStore.set(holdToQuitOverlayOpenAtom, false);
      jotaiStore.set(isAppQuittingAtom, true);

      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch (error) {
      const jotaiStore = getInstrumentedStore();
      jotaiStore.set(isAppQuittingAtom, false);
      jotaiStore.set(holdToQuitOverlayOpenAtom, false);
      quitInProgress = false;
      if (holdToQuitTimer) {
        clearTimeout(holdToQuitTimer);
        holdToQuitTimer = null;
      }
      logger.error("failed to quit app", error);
    }
  }, []);

  const confirmAndQuit = useCallback(async () => {
    await handleQuit();
  }, [handleQuit]);

  const cancelHoldToQuit = useCallback(() => {
    if (holdToQuitTimer) {
      clearTimeout(holdToQuitTimer);
      holdToQuitTimer = null;
    }
    getInstrumentedStore().set(holdToQuitOverlayOpenAtom, false);
  }, []);

  const startHoldToQuit = useCallback(() => {
    if (!isTauriDesktop() || quitInProgress || holdToQuitTimer) return;

    getInstrumentedStore().set(holdToQuitOverlayOpenAtom, true);
    holdToQuitTimer = setTimeout(() => {
      holdToQuitTimer = null;
      getInstrumentedStore().set(holdToQuitOverlayOpenAtom, false);
      void handleQuit();
    }, HOLD_TO_QUIT_MS);
  }, [handleQuit]);

  const handleHideWindow = useCallback(async () => {
    if (!isTauriDesktop()) return;

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      await window.hide();
    } catch (_error) {
      // Hide is best-effort; failed window state changes should not interrupt shortcuts.
    }
  }, []);

  return {
    handleQuit,
    confirmAndQuit,
    startHoldToQuit,
    cancelHoldToQuit,
    handleHideWindow,
  };
}
