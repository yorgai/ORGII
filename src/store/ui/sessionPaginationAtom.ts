import { atom } from "jotai";

// ============================================
// Execution Thread Selector State
// ============================================

/**
 * Selected thread ID for filtering execution stage events.
 * When set, only events from this thread are shown in the ChatHistory.
 * null = show all threads (no filtering)
 *
 * This is used by the ThreadSelector component in ChatPanel
 * to filter events during execution stages.
 */
export const selectedExecutionThreadAtom = atom<string | null>(null);
selectedExecutionThreadAtom.debugLabel = "selectedExecutionThreadAtom";

// ============================================
// Legacy activity scroll prefetch state
// ============================================

export const ACTIVITY_PREFETCH_CONFIG = {
  enabled: true,
  thresholdItemsFromEnd: 20,
} as const;

// ============================================
// Pagination State for Activity Infinite Scroll
// ============================================

/**
 * Whether there are more activities to load (from API has_more flag)
 */
export const hasMoreActivitiesAtom = atom<boolean>(false);
hasMoreActivitiesAtom.debugLabel = "hasMoreActivitiesAtom";

/**
 * Whether older activities are currently being loaded
 */
export const isLoadingMoreActivitiesAtom = atom<boolean>(false);
isLoadingMoreActivitiesAtom.debugLabel = "isLoadingMoreActivitiesAtom";

/**
 * Callback to load older activities (set by useSessionSync)
 * This is stored as a ref-like atom so components can call it
 */
export const loadMoreActivitiesCallbackAtom = atom<(() => void) | null>(null);
loadMoreActivitiesCallbackAtom.debugLabel = "loadMoreActivitiesCallbackAtom";

// NOTE: Session event atoms REMOVED - moved to @src/engines/SessionCore
// Use eventsAtom (SessionEvent[]) as single source of truth
