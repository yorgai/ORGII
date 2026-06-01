/**
 * Search Result Selection Atom
 *
 * PERFORMANCE: Uses Jotai atom for selection state instead of component state.
 * This means only the previously-selected and newly-selected items re-render
 * when selection changes, instead of ALL items re-rendering.
 *
 * SCROLL PRESERVATION (Jan 2026):
 * Also stores scroll position externally so it survives component remounting.
 * This fixes the issue where clicking a search result would reset scroll to top.
 *
 * Pattern copied from fileTreeSelectionAtom.ts
 */
import { atom, useAtomValue } from "jotai";

// ============================================
// Selection State Atom
// ============================================

/**
 * Selected search result key (e.g., "match:/path/file.ts:3" or "file:/path/file.ts")
 */
export const searchResultSelectedKeyAtom = atom<string | null>(null);

// ============================================
// Scroll Position Atom
// ============================================

/**
 * Scroll position for search results list.
 * Stored externally so it survives component remounting during tab operations.
 */
export const searchResultScrollPositionAtom = atom<number>(0);

/**
 * First visible item key for scroll restoration.
 * Used when the list structure changes (expand/collapse) to maintain context.
 */
export const searchResultFirstVisibleKeyAtom = atom<string | null>(null);

// ============================================
// Selection Hook
// ============================================

/**
 * Hook to check if a specific search result is selected.
 * Only re-renders when THIS item's selection state changes.
 *
 * @param key - The unique key for this item (e.g., "match:/path:3" or "file:/path")
 */
export function useIsSearchResultSelected(key: string): boolean {
  const selectedKey = useAtomValue(searchResultSelectedKeyAtom);
  return selectedKey === key;
}
