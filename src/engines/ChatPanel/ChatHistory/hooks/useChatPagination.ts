/**
 * useChatPagination Hook
 *
 * Manages activity pagination:
 * - Reads hasMore / isLoading / loadMore from global atoms
 * - Prefetch when scrolling near the end
 * - End-reached handler
 * - Auto-load when the initial list is too short to scroll
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef } from "react";

import {
  ACTIVITY_PREFETCH_CONFIG,
  hasMoreActivitiesAtom,
  isLoadingMoreActivitiesAtom,
  loadMoreActivitiesCallbackAtom,
} from "@src/store/ui/sessionPaginationAtom";

// ============================================
// Types
// ============================================

export interface UseChatPaginationOptions {
  optimizedChatHistoryLength: number;
  setVisibleRange: React.Dispatch<
    React.SetStateAction<{ startIndex: number; endIndex: number }>
  >;
  /** Optional ref updated immediately on every range change (no debounce).
   *  Callers that need the latest endIndex without waiting for the
   *  debounced state update can read this ref. */
  visibleRangeEndRef?: React.MutableRefObject<number>;
}

export interface UseChatPaginationReturn {
  isLoadingMore: boolean;
  handleRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  handleEndReached: () => void;
}

// ============================================
// Hook
// ============================================

const MAX_AUTO_LOAD_ATTEMPTS = 10;

/** Debounce interval for setVisibleRange state updates.
 *  Prevents scroll → re-render → scroll feedback loops that cause
 *  sticky-header "kissing" bounce when two group headers are adjacent. */
const RANGE_DEBOUNCE_MS = 150;

export function useChatPagination({
  optimizedChatHistoryLength,
  setVisibleRange,
  visibleRangeEndRef,
}: UseChatPaginationOptions): UseChatPaginationReturn {
  const hasMoreActivities = useAtomValue(hasMoreActivitiesAtom);
  const isLoadingMore = useAtomValue(isLoadingMoreActivitiesAtom);
  const loadMoreActivities = useAtomValue(loadMoreActivitiesCallbackAtom);

  const rangeDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    return () => {
      if (rangeDebounceRef.current) clearTimeout(rangeDebounceRef.current);
    };
  }, []);

  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      // Update ref immediately so auto-scroll logic stays responsive.
      if (visibleRangeEndRef) {
        visibleRangeEndRef.current = range.endIndex;
      }

      // Debounce the state update to avoid re-render jitter during
      // sticky-header transitions (the "kissing" bounce).
      clearTimeout(rangeDebounceRef.current);
      rangeDebounceRef.current = setTimeout(() => {
        setVisibleRange(range);
      }, RANGE_DEBOUNCE_MS);

      if (ACTIVITY_PREFETCH_CONFIG.enabled) {
        const itemsFromEnd = optimizedChatHistoryLength - 1 - range.endIndex;
        const shouldPrefetch =
          itemsFromEnd <= ACTIVITY_PREFETCH_CONFIG.thresholdItemsFromEnd;

        if (
          shouldPrefetch &&
          hasMoreActivities &&
          !isLoadingMore &&
          loadMoreActivities
        ) {
          loadMoreActivities();
        }
      }
    },
    [
      setVisibleRange,
      visibleRangeEndRef,
      optimizedChatHistoryLength,
      hasMoreActivities,
      isLoadingMore,
      loadMoreActivities,
    ]
  );

  // Handle scroll to bottom — load more (newer) activities
  const handleEndReached = useCallback(() => {
    if (optimizedChatHistoryLength === 0) return;
    if (hasMoreActivities && !isLoadingMore && loadMoreActivities) {
      loadMoreActivities();
    }
  }, [
    hasMoreActivities,
    isLoadingMore,
    loadMoreActivities,
    optimizedChatHistoryLength,
  ]);

  // Auto-load counter — reset when chat history is cleared (new session)
  const autoLoadAttemptsRef = useRef(0);

  useEffect(() => {
    if (optimizedChatHistoryLength === 0) {
      autoLoadAttemptsRef.current = 0;
    }
  }, [optimizedChatHistoryLength]);

  // Auto-load when list is too short to scroll but has more data
  useEffect(() => {
    if (
      optimizedChatHistoryLength > 0 &&
      optimizedChatHistoryLength < 15 &&
      hasMoreActivities &&
      !isLoadingMore &&
      loadMoreActivities &&
      autoLoadAttemptsRef.current < MAX_AUTO_LOAD_ATTEMPTS
    ) {
      autoLoadAttemptsRef.current += 1;
      const timer = setTimeout(() => {
        loadMoreActivities();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [
    optimizedChatHistoryLength,
    hasMoreActivities,
    isLoadingMore,
    loadMoreActivities,
  ]);

  return {
    isLoadingMore,
    handleRangeChanged,
    handleEndReached,
  };
}
