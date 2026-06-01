/**
 * useQueryHistory Hook
 *
 * Manages SQL query history for a database connection.
 * History is persisted to localStorage.
 */
import { useCallback, useState } from "react";

import {
  type QueryHistoryItem,
  clearQueryHistory,
  loadQueryHistory,
  saveQueryToHistory,
} from "@src/store/workstation/database";

// ============================================
// Types
// ============================================

export interface UseQueryHistoryReturn {
  /** Query history items (most recent first) */
  history: QueryHistoryItem[];
  /** Add a query to history */
  addQuery: (item: Omit<QueryHistoryItem, "timestamp">) => void;
  /** Clear all history */
  clearHistory: () => void;
  /** Refresh history from storage */
  refresh: () => void;
}

// ============================================
// Hook
// ============================================

export function useQueryHistory(connectionId: string): UseQueryHistoryReturn {
  // Initialize history from storage (computed during render, not in effect)
  const [history, setHistory] = useState<QueryHistoryItem[]>(() =>
    connectionId ? loadQueryHistory(connectionId) : []
  );

  // Track connection changes and reload history
  const [prevConnectionId, setPrevConnectionId] = useState(connectionId);
  if (connectionId !== prevConnectionId) {
    setPrevConnectionId(connectionId);
    const loaded = connectionId ? loadQueryHistory(connectionId) : [];
    setHistory(loaded);
  }

  // Add a query to history
  const addQuery = useCallback(
    (item: Omit<QueryHistoryItem, "timestamp">) => {
      if (!connectionId) return;

      const fullItem: QueryHistoryItem = {
        ...item,
        timestamp: Date.now(),
      };

      // Save to storage
      saveQueryToHistory(connectionId, fullItem);

      // Update local state
      setHistory((prev) => {
        const newHistory = [fullItem, ...prev];
        // Keep max 50
        if (newHistory.length > 50) {
          newHistory.length = 50;
        }
        return newHistory;
      });
    },
    [connectionId]
  );

  // Clear all history
  const clearHistory = useCallback(() => {
    if (!connectionId) return;
    clearQueryHistory(connectionId);
    setHistory([]);
  }, [connectionId]);

  // Refresh from storage
  const refresh = useCallback(() => {
    if (!connectionId) return;
    const loaded = loadQueryHistory(connectionId);
    setHistory(loaded);
  }, [connectionId]);

  return {
    history,
    addQuery,
    clearHistory,
    refresh,
  };
}

export default useQueryHistory;
