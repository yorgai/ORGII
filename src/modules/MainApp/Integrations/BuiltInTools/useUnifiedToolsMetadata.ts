/**
 * Shared backend metadata for the unified tools list (built-in + custom names).
 *
 * Uses module-level caching to prevent re-fetching on every component mount.
 * Similar to simulatorMap.ts caching pattern.
 */
import { useCallback, useEffect, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import { invokeTauri } from "@src/util/platform/tauri/init";

import type { RawToolInfo } from "./types";

const log = createLogger("Tools");

// ============================================
// Module-level cache (prevents re-fetch on every mount)
// ============================================

/** Cached tools list (null = not fetched yet). */
let cachedTools: RawToolInfo[] | null = null;

/** In-flight fetch promise to prevent duplicate requests. */
let fetchPromise: Promise<RawToolInfo[]> | null = null;

/**
 * Fetch tools with deduplication.
 * Multiple concurrent calls share the same promise.
 */
async function fetchToolsOnce(): Promise<RawToolInfo[]> {
  if (cachedTools !== null) {
    return cachedTools;
  }

  if (fetchPromise !== null) {
    return fetchPromise;
  }

  fetchPromise = invokeTauri<RawToolInfo[]>("list_all_tools")
    .then((result) => {
      cachedTools = result;
      fetchPromise = null;
      return result;
    })
    .catch((err) => {
      fetchPromise = null;
      throw err;
    });

  return fetchPromise;
}

/**
 * Clear the module-level cache and force re-fetch.
 */
export function clearToolsCache(): void {
  cachedTools = null;
  fetchPromise = null;
}

// ============================================
// React hook
// ============================================

export function useUnifiedToolsMetadata() {
  const [rawTools, setRawTools] = useState<RawToolInfo[]>(cachedTools ?? []);
  const [loading, setLoading] = useState(cachedTools === null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    clearToolsCache();
    setLoading(true);
    setError(null);
    fetchToolsOnce()
      .then((result) => {
        setRawTools(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        log.error("[Tools] Failed to list tools:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (cachedTools !== null) {
      return;
    }

    let cancelled = false;
    fetchToolsOnce()
      .then((result) => {
        if (!cancelled) {
          setRawTools(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        log.error("[Tools] Failed to list tools:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rawTools, loading, error, refresh };
}
