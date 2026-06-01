import type { UnlistenFn } from "@tauri-apps/api/event";
import { useCallback } from "react";

export function useWebviewSafeUnlisten() {
  // Defer the unlisten call so it doesn't fire during a Tauri event dispatch.
  // No per-instance "already cleaned up" flag — each caller is responsible for
  // nulling its own ref after calling safeUnlisten so it isn't called twice.
  const safeUnlisten = useCallback((listenerFn: UnlistenFn | null) => {
    if (!listenerFn) return;
    setTimeout(() => {
      try {
        listenerFn();
      } catch {
        // Listener may already be torn down by Tauri
      }
    }, 0);
  }, []);

  return { safeUnlisten };
}
