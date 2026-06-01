import { useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  clearSessionLoadErrorAtom,
  loadStatusAtom,
  triggerSessionReloadAtom,
} from "@src/engines/SessionCore";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { activeSessionIdAtom } from "@src/store/session";

export function useReloadSession(activeId: string | null) {
  const clearSessionLoadError = useSetAtom(clearSessionLoadErrorAtom);
  const setLoadStatus = useSetAtom(loadStatusAtom);
  const triggerSessionReload = useSetAtom(triggerSessionReloadAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);

  return useCallback(() => {
    if (!activeId) return;
    eventStoreProxy.evictSession(activeId);
    clearSessionLoadError();
    setLoadStatus("loading");
    setActiveSessionId(activeId);
    triggerSessionReload(activeId);
  }, [
    activeId,
    clearSessionLoadError,
    setActiveSessionId,
    setLoadStatus,
    triggerSessionReload,
  ]);
}
