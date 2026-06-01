/**
 * useSessionManager Hook
 *
 * Centralized hook for loading the global sessions list. The hook is a
 * thin wrapper around the centralized session store and handles
 * cache-invalidation events; it does not own any "selected session" state
 * (the WorkStation-active session lives in `workstationActiveSessionIdAtom`
 * and the global event-pipeline session lives in `activeSessionIdAtom`).
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { reposAtom } from "@src/store/repo";
import {
  SESSION_CACHE_INVALIDATED_EVENT,
  SESSION_CACHE_INVALIDATION_KEY,
  Session,
  loadSessions as centralLoadSessions,
  getSessionCacheInvalidationTimestamp,
  resetSessionStore,
  sessionErrorAtom,
  sessionLastLoadedAtom,
  sessionLoadingAtom,
  sessionsAtom,
} from "@src/store/session";

export interface UseSessionManagerOptions {
  /** Auto-load sessions on mount (default: true) */
  autoLoad?: boolean;
}

export interface UseSessionManagerReturn {
  sessions: Session[];
  filteredSessions: Session[];
  sessionLoading: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;

  isReady: boolean;
}

export function useSessionManager(
  options: UseSessionManagerOptions = {}
): UseSessionManagerReturn {
  const { autoLoad = true } = options;

  const sessions = useAtomValue(sessionsAtom);
  const sessionLoading = useAtomValue(sessionLoadingAtom);
  const error = useAtomValue(sessionErrorAtom);
  const lastLoadedAt = useAtomValue(sessionLastLoadedAtom);

  const repos = useAtomValue(reposAtom);

  const isLoadingRef = useRef(false);
  // Mirror sessions.length in a ref so loadSessions can read it without
  // being recreated every time the list grows.  Without this, sessions.length
  // in the dep array causes loadSessions to change identity after every load,
  // which re-fires the autoLoad useEffect and risks a self-exciting loop if
  // the isLoadingRef guard is ever cleared while a fetch is still in-flight
  // (e.g. the forceRefresh path calls resetSessionStore() and resets it).
  const sessionsLengthRef = useRef(sessions.length);
  sessionsLengthRef.current = sessions.length;

  const loadSessions = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }

    const invalidationTimestamp = getSessionCacheInvalidationTimestamp();
    const cacheWasInvalidated =
      invalidationTimestamp !== null &&
      invalidationTimestamp > 0 &&
      (!lastLoadedAt || invalidationTimestamp > lastLoadedAt);

    if (cacheWasInvalidated) {
      resetSessionStore();
      localStorage.removeItem(SESSION_CACHE_INVALIDATION_KEY);
    }

    isLoadingRef.current = true;

    try {
      await centralLoadSessions({
        forceRefresh: cacheWasInvalidated || sessionsLengthRef.current === 0,
      });
    } catch (err) {
      console.error("[useSessionManager] Failed to load sessions:", err);
    } finally {
      isLoadingRef.current = false;
    }
  }, [lastLoadedAt]);

  const forceRefresh = useCallback(async () => {
    resetSessionStore();
    localStorage.removeItem(SESSION_CACHE_INVALIDATION_KEY);
    isLoadingRef.current = false;
    await loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (autoLoad && repos.length > 0) {
      loadSessions();
    }
  }, [autoLoad, repos.length, loadSessions]);

  useEffect(() => {
    const handleCacheInvalidated = () => {
      forceRefresh();
    };

    window.addEventListener(
      SESSION_CACHE_INVALIDATED_EVENT,
      handleCacheInvalidated
    );

    return () => {
      window.removeEventListener(
        SESSION_CACHE_INVALIDATED_EVENT,
        handleCacheInvalidated
      );
    };
  }, [forceRefresh]);

  return {
    sessions,
    filteredSessions: sessions,
    sessionLoading,
    error,

    loadSessions,

    isReady: !sessionLoading && sessions.length >= 0,
  };
}

export default useSessionManager;
