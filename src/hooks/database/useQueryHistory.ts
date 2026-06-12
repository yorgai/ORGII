/**
 * useQueryHistory Hook
 *
 * Manages SQL query history for a database connection.
 * History is persisted to localStorage via `queryHistoryAtom` (atomWithStorage).
 */
import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  MAX_HISTORY_PER_CONNECTION,
  type QueryHistoryItem,
  queryHistoryAtom,
} from "@src/store/workstation/database";

// ============================================
// Types
// ============================================

export interface UseQueryHistoryReturn {
  /** Query history items (most recent first) */
  history: QueryHistoryItem[];
  /** Add a query to history */
  addQuery: (item: Omit<QueryHistoryItem, "timestamp">) => void;
  /** Clear all history for this connection */
  clearHistory: () => void;
}

// ============================================
// Hook
// ============================================

export function useQueryHistory(connectionId: string): UseQueryHistoryReturn {
  const [allHistory, setAllHistory] = useAtom(queryHistoryAtom);

  const history: QueryHistoryItem[] = connectionId
    ? (allHistory[connectionId] ?? [])
    : [];

  const addQuery = useCallback(
    (item: Omit<QueryHistoryItem, "timestamp">) => {
      if (!connectionId) return;

      const fullItem: QueryHistoryItem = {
        ...item,
        timestamp: Date.now(),
      };

      setAllHistory((prev) => {
        const existing = prev[connectionId] ?? [];
        const updated = [fullItem, ...existing];
        if (updated.length > MAX_HISTORY_PER_CONNECTION) {
          updated.length = MAX_HISTORY_PER_CONNECTION;
        }
        return { ...prev, [connectionId]: updated };
      });
    },
    [connectionId, setAllHistory]
  );

  const clearHistory = useCallback(() => {
    if (!connectionId) return;
    setAllHistory((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
  }, [connectionId, setAllHistory]);

  return {
    history,
    addQuery,
    clearHistory,
  };
}

export default useQueryHistory;
