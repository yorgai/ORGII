/**
 * useScrollPreservation Hook
 *
 * Maintains scroll position when tree structure changes using VSCode's
 * anchor element pattern. Prevents "jump to top" when expanding/collapsing.
 *
 * Key improvements over previous implementation:
 * 1. Delta tracking: Tracks pixel offset from viewport top, not just path
 * 2. Content-based change detection: Detects structural changes, not just length
 * 3. Abort pattern: Uses restoration ID instead of timeout to prevent races
 * 4. Single update source: Caller controls when anchor is updated
 *
 * @see VSCode's listView.ts _rerender() for reference implementation
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type {
  FlattenedTreeNode,
  ScrollAnchor,
  TreeNodeBase,
  UseScrollPreservationOptions,
  UseScrollPreservationReturn,
} from "../types";

/**
 * Generate a fingerprint of tree structure for change detection.
 * Uses first N paths + total length for efficiency.
 */
function getTreeFingerprint<TNode extends TreeNodeBase>(
  nodes: FlattenedTreeNode<TNode>[]
): string {
  if (nodes.length === 0) return "empty";

  // Sample first 10 paths + length for fast comparison
  const sampleSize = Math.min(10, nodes.length);
  const samples: string[] = [];
  for (let idx = 0; idx < sampleSize; idx++) {
    samples.push(nodes[idx].node.path);
  }

  return `${nodes.length}:${samples.join("|")}`;
}

export function useScrollPreservation<TNode extends TreeNodeBase>({
  flattenedNodes,
  virtuosoRef,
  lastScrollTopRef,
  rowHeight,
  scrollerDomRef,
}: UseScrollPreservationOptions<TNode>): UseScrollPreservationReturn {
  // Anchor element with delta tracking (VSCode pattern)
  const anchorRef = useRef<ScrollAnchor | null>(null);

  // Restoration state
  const isRestoringRef = useRef(false);
  const restorationIdRef = useRef(0);

  // Previous tree fingerprint for change detection
  const prevFingerprintRef = useRef<string>("");

  // Keep a ref to flattenedNodes for the updateAnchor callback
  const flattenedNodesRef = useRef<FlattenedTreeNode<TNode>[]>(flattenedNodes);

  // Update ref in effect (not during render) per React rules
  useEffect(() => {
    flattenedNodesRef.current = flattenedNodes;
  }, [flattenedNodes]);

  /**
   * Update the scroll anchor from current scroll position.
   * Call this during scroll events (when not restoring).
   */
  const updateAnchor = useCallback(() => {
    // Skip if restoring - don't overwrite anchor during restoration
    if (isRestoringRef.current) return;

    const nodes = flattenedNodesRef.current;
    if (nodes.length === 0) {
      anchorRef.current = null;
      return;
    }

    const scrollTop = lastScrollTopRef.current;

    // Find the first visible index
    const firstVisibleIndex = Math.min(
      nodes.length - 1,
      Math.max(0, Math.floor(scrollTop / rowHeight))
    );

    // Calculate delta: how many pixels is this element from the viewport top?
    // Positive = element top is below viewport top
    // Negative = element top is above viewport top (partially scrolled out)
    const elementTop = firstVisibleIndex * rowHeight;
    const deltaFromTop = elementTop - scrollTop;

    anchorRef.current = {
      path: nodes[firstVisibleIndex].node.path,
      deltaFromTop,
    };
  }, [lastScrollTopRef, rowHeight]);

  // Use useLayoutEffect to restore scroll BEFORE paint (prevents visible jump)
  useLayoutEffect(() => {
    const currentFingerprint = getTreeFingerprint(flattenedNodes);
    const prevFingerprint = prevFingerprintRef.current;
    prevFingerprintRef.current = currentFingerprint;

    // Skip on first render or if nothing changed
    if (!prevFingerprint || prevFingerprint === currentFingerprint) {
      return;
    }

    // Skip if no virtuoso ref
    if (!virtuosoRef.current) {
      return;
    }

    // Skip if no anchor to restore to
    if (!anchorRef.current) {
      // Initialize anchor from current scroll position
      updateAnchor();
      return;
    }

    const { path: targetPath, deltaFromTop } = anchorRef.current;

    // Find the path in the new tree
    const newIndex = flattenedNodes.findIndex(
      (item) => item.node.path === targetPath
    );

    if (newIndex !== -1) {
      // Calculate the new scroll position that preserves the delta
      const newElementTop = newIndex * rowHeight;
      const newScrollTop = newElementTop - deltaFromTop;

      // Increment restoration ID to invalidate any pending updates
      const currentRestorationId = ++restorationIdRef.current;
      isRestoringRef.current = true;

      // Scroll to the calculated position
      // Using scrollTop directly instead of scrollToIndex for precise positioning
      virtuosoRef.current.scrollToIndex({
        index: newIndex,
        align: "start",
        behavior: "auto",
      });

      // Adjust by delta after scrollToIndex completes
      // scrollToIndex aligns to start, we need to apply our delta
      if (Math.abs(deltaFromTop) > 1) {
        // If delta is significant, we need manual scroll adjustment
        // Use requestAnimationFrame to ensure Virtuoso has processed the scroll
        requestAnimationFrame(() => {
          if (restorationIdRef.current !== currentRestorationId) return;

          const scrollContainer = scrollerDomRef.current;
          if (scrollContainer) {
            scrollContainer.scrollTop = Math.max(0, newScrollTop);
            lastScrollTopRef.current = scrollContainer.scrollTop;
          }

          // Clear restoration flag after a frame
          requestAnimationFrame(() => {
            if (restorationIdRef.current === currentRestorationId) {
              isRestoringRef.current = false;
            }
          });
        });
      } else {
        // Delta is negligible, just clear restoration flag
        lastScrollTopRef.current = newIndex * rowHeight;
        requestAnimationFrame(() => {
          if (restorationIdRef.current === currentRestorationId) {
            isRestoringRef.current = false;
          }
        });
      }
    } else {
      // Path not found - might have been collapsed
      // Try to find a parent path that still exists
      const segments = targetPath.split("/");
      let foundParent = false;

      for (let depth = segments.length - 1; depth > 0; depth--) {
        const parentPath = segments.slice(0, depth).join("/");
        const parentIndex = flattenedNodes.findIndex(
          (item) => item.node.path === parentPath
        );

        if (parentIndex !== -1) {
          // Found a parent, scroll to it
          const currentRestorationId = ++restorationIdRef.current;
          isRestoringRef.current = true;

          virtuosoRef.current.scrollToIndex({
            index: parentIndex,
            align: "start",
            behavior: "auto",
          });

          lastScrollTopRef.current = parentIndex * rowHeight;

          // Update anchor to the parent
          anchorRef.current = {
            path: parentPath,
            deltaFromTop: 0,
          };

          requestAnimationFrame(() => {
            if (restorationIdRef.current === currentRestorationId) {
              isRestoringRef.current = false;
            }
          });

          foundParent = true;
          break;
        }
      }

      if (!foundParent) {
        // No parent found, reset anchor
        anchorRef.current = null;
      }
    }
  }, [
    flattenedNodes,
    virtuosoRef,
    lastScrollTopRef,
    rowHeight,
    scrollerDomRef,
    updateAnchor,
  ]);

  return { updateAnchor, isRestoringRef };
}
