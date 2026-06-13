/**
 * useAppDeferredInitialization
 *
 * Runs heavy one-time startup work after the first paint using
 * `requestIdleCallback` (fallback: 100 ms `setTimeout`), then returns `true`
 * once initialization is complete.
 *
 * Work performed (in order):
 * 1. `preloadCache`     — warm localStorage read-through cache
 * 2. `initSessionCore`  — register adapters and EventStoreProxy; must precede
 *                         any session read/write operation
 * 3. `initToolRegistry` — single IPC call to Rust to populate the unified tool
 *                         registry (replaces separate initBuiltinSimulatorMap +
 *                         initCliToolAliasMap calls)
 *
 * The returned boolean gates `AppDeferredServices` and `ExtensionUIProvider`
 * so they don't mount until the core is ready.
 *
 * The effect is cancel-safe: if the component unmounts before the idle callback
 * fires (e.g. fast HMR), `cancelledRef` prevents a stale `setState`.
 */
import React, { useEffect, useRef } from "react";

import { initSessionCore } from "@src/engines/SessionCore";
import { initToolRegistry } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { createLogger } from "@src/hooks/logger";
import { preloadCache } from "@src/util/core/storage/localStorage";

const log = createLogger("App");

export function useAppDeferredInitialization(): boolean {
  const [deferredComponentsReady, setDeferredComponentsReady] =
    React.useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const initDeferred = async () => {
      if (cancelledRef.current) {
        return;
      }

      try {
        preloadCache();
      } catch (error) {
        log.error("[App] localStorage cache preload failed:", error);
      }

      // Initialize SessionCore: await so the Tauri es:changed listener is
      // registered before AppDeferredServices mounts and begins loading sessions.
      await initSessionCore();

      // Initialize the unified tool registry before deferred services load
      // sessions, otherwise early chat rendering can fall back to generic tool
      // blocks and display read-file contents as pseudo diff stats.
      await initToolRegistry();

      if (!cancelledRef.current) {
        setDeferredComponentsReady(true);
      }
    };

    let idleCallbackId: ReturnType<typeof requestIdleCallback> | undefined;

    if ("requestIdleCallback" in window) {
      idleCallbackId = requestIdleCallback(
        () => {
          initDeferred().catch((error) => {
            log.error("[App] Deferred init failed:", error);
          });
        },
        { timeout: 2000 }
      );

      return () => {
        cancelledRef.current = true;
        if (idleCallbackId !== undefined) cancelIdleCallback(idleCallbackId);
      };
    }

    const timeoutId = setTimeout(() => {
      initDeferred().catch((error) => {
        log.error("[App] Deferred init failed:", error);
      });
    }, 100);

    return () => {
      cancelledRef.current = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return deferredComponentsReady;
}
