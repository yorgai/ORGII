import { useCallback, useEffect } from "react";

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

async function requestNativeQuitAfterRelease() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("complete_hold_to_quit");
}

async function requestNativeCancelHoldToQuit() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("cancel_hold_to_quit");
}

function cancelLocalHoldToQuit() {
  if (holdToQuitTimer) {
    clearTimeout(holdToQuitTimer);
    holdToQuitTimer = null;
  }
  getInstrumentedStore().set(holdToQuitOverlayOpenAtom, false);
}

export function useWindowShortcuts() {
  const handleQuit = useCallback(async () => {
    if (!isTauriDesktop() || quitInProgress) return;

    quitInProgress = true;

    try {
      const jotaiStore = getInstrumentedStore();
      jotaiStore.set(holdToQuitOverlayOpenAtom, false);
      jotaiStore.set(isAppQuittingAtom, true);

      await requestNativeQuitAfterRelease();
      quitInProgress = false;
      jotaiStore.set(isAppQuittingAtom, false);
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

  const cancelHoldToQuit = useCallback(() => {
    if (quitInProgress) return;
    cancelLocalHoldToQuit();
    if (isTauriDesktop()) {
      void requestNativeCancelHoldToQuit();
    }
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

  useEffect(() => {
    if (!isTauriDesktop()) return;

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const unlistenStart = await listen("native-hold-to-quit-start", () => {
        if (!cancelled) startHoldToQuit();
      });
      unlisteners.push(unlistenStart);

      const unlistenCancel = await listen("native-hold-to-quit-cancel", () => {
        if (!cancelled) cancelLocalHoldToQuit();
      });
      unlisteners.push(unlistenCancel);
    };

    const handleFocusLoss = () => cancelHoldToQuit();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelHoldToQuit();
    };

    window.addEventListener("blur", handleFocusLoss);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void setupListeners();

    return () => {
      cancelled = true;
      window.removeEventListener("blur", handleFocusLoss);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlisteners.forEach((unlisten) => unlisten());
      cancelHoldToQuit();
    };
  }, [cancelHoldToQuit, startHoldToQuit]);

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
    startHoldToQuit,
    cancelHoldToQuit,
    handleHideWindow,
  };
}
