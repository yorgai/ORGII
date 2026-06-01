import { useEffect } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import type { SessionSyncRefs } from "./sessionSyncTypes";
import { EVENT_STORE_CACHE_SYNC_INTERVAL_MS } from "./sessionSyncUtils";

function saveSessionEventsToCache(sessionId: string): void {
  if (isCursorIdeSession(sessionId)) return;
  eventStoreProxy.saveToCache(sessionId);
}

export function useEventStoreCacheSync(sessionId: string | null): void {
  useEffect(() => {
    if (!sessionId || isCursorIdeSession(sessionId)) return;
    const interval = setInterval(() => {
      saveSessionEventsToCache(sessionId);
    }, EVENT_STORE_CACHE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId]);
}

export function useSessionSyncCleanup(
  refs: Pick<SessionSyncRefs, "prevSessionIdRef" | "handlerRef">
): void {
  useEffect(() => {
    return () => {
      if (refs.prevSessionIdRef.current) {
        saveSessionEventsToCache(refs.prevSessionIdRef.current);
      }
      if (refs.handlerRef.current) {
        refs.handlerRef.current.dispose();
        refs.handlerRef.current = null;
      }
    };
  }, [refs.handlerRef, refs.prevSessionIdRef]);
}

export function disposeCurrentHandler(
  refs: Pick<SessionSyncRefs, "handlerRef">
): void {
  if (refs.handlerRef.current) {
    refs.handlerRef.current.dispose();
    refs.handlerRef.current = null;
  }
}

export function resetReloadGuardForSession(
  sessionId: string,
  refs: Pick<SessionSyncRefs, "prevSessionIdRef" | "prevReloadEpochRef">
): void {
  if (refs.prevSessionIdRef.current === sessionId) {
    refs.prevSessionIdRef.current = null;
    refs.prevReloadEpochRef.current = 0;
  }
}
