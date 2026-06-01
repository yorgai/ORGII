/**
 * useRevealPath Hook
 *
 * Handles "Reveal in Explorer" - scrolls to a specific file in the tree.
 * Polls for async directory expansion and skips if already visible.
 *
 * SCROLL PRESERVATION (Jan 2026):
 * When switching between tabs/files, if the target file is already visible
 * in the viewport, preserve the scroll position. This prevents jarring scrolls
 * when the user switches between nearby files.
 *
 * LAYOUT SHIFT FIX (Feb 2026):
 * Skip scrolling when WorkStation is hidden (viewMode !== "workStation").
 * scrollIntoView on hidden elements can scroll parent containers (including #root),
 * causing unexpected layout shifts on the visible view.
 */
import { useAtomValue } from "jotai";
import {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import { TREE_ROW_HEIGHT } from "@src/components/TreeRow";
import { viewModeAtom } from "@src/store/ui/viewModeAtom";

import type { FlattenedNode } from "../types";
import { findFileInNodes } from "../utils/treeUtils";

export interface UseRevealPathOptions {
  revealPath: string | null;
  revealKey: number | null;
  selectedPath: string | null;
  virtuosoRef: RefObject<VirtuosoHandle>;
  useVirtualization: boolean;
  flattenedNodesRef: MutableRefObject<FlattenedNode[]>;
  lastScrollTopRef: MutableRefObject<number>;
  viewportHeight: number;
  stickyHeight: number;
}

/**
 * Check if a file at the given index is visible in the viewport.
 * Uses the effective viewport height (accounting for sticky headers).
 */
function isIndexVisible(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  stickyHeight: number
): boolean {
  // Guard: viewport not ready
  if (viewportHeight <= 0) return false;

  const effectiveHeight = viewportHeight - stickyHeight;
  if (effectiveHeight <= TREE_ROW_HEIGHT) return false;

  // Calculate visible row range
  const firstVisibleIdx = Math.floor(scrollTop / TREE_ROW_HEIGHT);
  const lastVisibleIdx = Math.floor(
    (scrollTop + effectiveHeight) / TREE_ROW_HEIGHT
  );

  // Check if index is within the visible range (inclusive)
  // No buffer needed - if the file is anywhere in the visible area,
  // preserve scroll position to avoid jarring jumps when switching tabs
  return index >= firstVisibleIdx && index <= lastVisibleIdx;
}

export function useRevealPath({
  revealPath,
  revealKey,
  selectedPath,
  virtuosoRef,
  useVirtualization,
  flattenedNodesRef,
  lastScrollTopRef,
  viewportHeight,
  stickyHeight,
}: UseRevealPathOptions): void {
  const lastRevealKeyRef = useRef<number | null>(null);
  const viewMode = useAtomValue(viewModeAtom);

  // Check if WorkStation is currently visible (Workstation view mode is active)
  const isVisible = viewMode === "workStation";

  useEffect(() => {
    if (revealKey === null || revealKey === lastRevealKeyRef.current) return;

    // Skip scrolling if WorkStation is not visible (user is on mainApp or session view)
    // This prevents scrollIntoView from scrolling the #root element, causing layout shifts
    if (!isVisible) {
      lastRevealKeyRef.current = revealKey;
      return;
    }

    const targetPath = revealPath || selectedPath || "";
    if (!targetPath) {
      lastRevealKeyRef.current = revealKey;
      return;
    }

    const attemptScroll = () => {
      const currentNodes = flattenedNodesRef.current;
      const index = findFileInNodes(currentNodes, targetPath);
      if (index === -1) return false;

      const actualPath = currentNodes[index].node.path;
      const scrollTop = lastScrollTopRef.current;

      // Check if already visible - preserve scroll position if so
      if (isIndexVisible(index, scrollTop, viewportHeight, stickyHeight)) {
        return true; // Already visible, no scroll needed
      }

      requestAnimationFrame(() => {
        if (useVirtualization && virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({
            index,
            align: "center",
            behavior: "smooth",
          });
        } else {
          document
            .querySelector(`[data-tree-path="${actualPath}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });

      return true;
    };

    if (attemptScroll()) {
      lastRevealKeyRef.current = revealKey;
      return;
    }

    // Poll for async directory expansion
    let attempts = 0;
    const intervalId = setInterval(() => {
      attempts++;
      if (attemptScroll() || attempts >= 20) {
        clearInterval(intervalId);
        lastRevealKeyRef.current = revealKey;
      }
    }, 100);

    return () => clearInterval(intervalId);
  }, [
    revealKey,
    revealPath,
    selectedPath,
    virtuosoRef,
    useVirtualization,
    flattenedNodesRef,
    lastScrollTopRef,
    viewportHeight,
    stickyHeight,
    isVisible,
  ]);
}
