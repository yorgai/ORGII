/**
 * VS Code Sticky Scroll Implementation
 *
 * Generic hook for VS Code-style sticky scroll with position-based clipping.
 * Direct port of VS Code's StickyScrollController logic from:
 * src/vs/base/browser/ui/tree/abstractTree.ts
 *
 * Key concepts:
 * - getRelativeTop: Returns where an element is in viewport as fraction (0-1)
 * - Position calculation uses viewport-relative coordinates
 * - Clipping effect: when last child scrolls up, sticky header slides up with it
 */
import { useMemo } from "react";

import {
  DEFAULT_MAX_STICKY_HEIGHT_RATIO,
  DEFAULT_MAX_STICKY_ITEMS,
  MIN_STICKY_DESCENDANTS,
} from "../config";
import type {
  FlattenedTreeNode,
  StickyScrollNode,
  TreeNodeBase,
  UseStickyScrollOptions,
  UseStickyScrollReturn,
} from "../types";

/**
 * VS Code's getRelativeTop equivalent
 * Returns the relative position (0-1) of an element in the viewport
 * Returns null if element is not visible
 */
function getRelativeTop(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number
): number | null {
  const elementTop = index * rowHeight;
  const elementBottom = elementTop + rowHeight;

  // Element is above viewport
  if (elementBottom <= scrollTop) {
    return null;
  }

  // Element is below viewport
  if (elementTop >= scrollTop + viewportHeight) {
    return null;
  }

  // Return relative position (0 = top of viewport, 1 = bottom)
  return (elementTop - scrollTop) / viewportHeight;
}

/**
 * Find the range (startIndex, endIndex) for a node
 * endIndex is the last visible descendant
 */
function getNodeRange<TNode extends TreeNodeBase>(
  flattenedNodes: FlattenedTreeNode<TNode>[],
  nodeIndex: number,
  nodeDepth: number
): { startIndex: number; endIndex: number } {
  const startIndex = nodeIndex;
  let endIndex = nodeIndex;

  // Find last descendant (nodes with depth > nodeDepth)
  for (let idx = nodeIndex + 1; idx < flattenedNodes.length; idx++) {
    if (flattenedNodes[idx].depth <= nodeDepth) {
      break;
    }
    endIndex = idx;
  }

  return { startIndex, endIndex };
}

/**
 * VS Code's calculateStickyNodePosition
 * Calculates position with clipping effect when last child scrolls up
 */
function calculateStickyNodePosition(
  endIndex: number,
  stickyRowPositionTop: number,
  stickyNodeHeight: number,
  scrollTop: number,
  viewportHeight: number,
  totalNodes: number,
  rowHeight: number
): number {
  let lastChildRelativeTop = getRelativeTop(
    endIndex,
    scrollTop,
    viewportHeight,
    rowHeight
  );

  // If the last descendant is only partially visible at the top of the view,
  // getRelativeTop() returns null. Use next node's relative top to calculate.
  if (lastChildRelativeTop === null && endIndex + 1 < totalNodes) {
    const nextNodeRelativeTop = getRelativeTop(
      endIndex + 1,
      scrollTop,
      viewportHeight,
      rowHeight
    );
    if (nextNodeRelativeTop !== null) {
      lastChildRelativeTop = nextNodeRelativeTop - rowHeight / viewportHeight;
    }
  }

  if (lastChildRelativeTop === null) {
    return stickyRowPositionTop;
  }

  // Convert relative position to pixels
  const topOfLastChild = lastChildRelativeTop * viewportHeight;
  const bottomOfLastChild = topOfLastChild + rowHeight;

  // Clipping effect: if sticky row would extend past last child's bottom,
  // push the row up so its bottom aligns with the last child's bottom
  if (
    stickyRowPositionTop + stickyNodeHeight > bottomOfLastChild &&
    stickyRowPositionTop <= bottomOfLastChild
  ) {
    return bottomOfLastChild - stickyNodeHeight;
  }

  return stickyRowPositionTop;
}

/**
 * Get parent node index by walking backwards.
 * Returns index only — avoids object allocation on the hot scroll path.
 */
function getParentIndex<TNode extends TreeNodeBase>(
  flattenedNodes: FlattenedTreeNode<TNode>[],
  nodeIndex: number
): number | undefined {
  const nodeDepth = flattenedNodes[nodeIndex].depth;

  if (nodeDepth === 0) {
    return undefined;
  }

  for (let idx = nodeIndex - 1; idx >= 0; idx--) {
    if (flattenedNodes[idx].depth === nodeDepth - 1) {
      return idx;
    }
  }

  return undefined;
}

/**
 * VS Code's getAncestorUnderPrevious
 * Find the next ancestor to make sticky, given the previous sticky node.
 * Returns index only — avoids object allocation on the hot scroll path.
 */
function getAncestorIndexUnderPrevious<TNode extends TreeNodeBase>(
  flattenedNodes: FlattenedTreeNode<TNode>[],
  nodeIndex: number,
  previousAncestorIndex: number | undefined
): number | undefined {
  let currentIndex = nodeIndex;
  let parentIdx = getParentIndex(flattenedNodes, currentIndex);

  while (parentIdx !== undefined) {
    if (
      previousAncestorIndex !== undefined &&
      parentIdx === previousAncestorIndex
    ) {
      return currentIndex;
    }
    currentIndex = parentIdx;
    parentIdx = getParentIndex(flattenedNodes, currentIndex);
  }

  if (previousAncestorIndex === undefined) {
    return currentIndex;
  }

  return undefined;
}

/**
 * Check if node is an expanded folder with visible children
 */
function nodeIsUncollapsedParent<TNode extends TreeNodeBase>(
  flattenedNodes: FlattenedTreeNode<TNode>[],
  nodeIndex: number
): boolean {
  const { startIndex, endIndex } = getNodeRange(
    flattenedNodes,
    nodeIndex,
    flattenedNodes[nodeIndex].depth
  );
  // Has more than just itself visible
  return endIndex > startIndex;
}

/**
 * Check if node's top aligns exactly with sticky area bottom
 */
function nodeTopAlignsWithStickyNodesBottom(
  nodeIndex: number,
  stickyNodesHeight: number,
  scrollTop: number,
  rowHeight: number
): boolean {
  const elementTop = nodeIndex * rowHeight;
  return scrollTop === elementTop - stickyNodesHeight;
}

/**
 * VS Code-style sticky scroll hook (generic)
 */
export function useStickyScroll<TNode extends TreeNodeBase>({
  flattenedNodes,
  viewportHeight,
  scrollTop,
  rowHeight,
  maxStickyItems = DEFAULT_MAX_STICKY_ITEMS,
  maxStickyHeightRatio = DEFAULT_MAX_STICKY_HEIGHT_RATIO,
}: UseStickyScrollOptions<TNode>): UseStickyScrollReturn<TNode> {
  return useMemo(() => {
    if (flattenedNodes.length === 0 || viewportHeight <= 0) {
      return { stickyNodes: [], stickyHeight: 0 };
    }

    // Calculate firstVisibleIndex from scrollTop to ensure they're always in sync
    // This prevents flashing when scrollTop updates before firstVisibleIndex
    const firstVisibleIndex = Math.min(
      flattenedNodes.length - 1,
      Math.max(0, Math.floor(scrollTop / rowHeight))
    );

    // No sticky headers needed if we're at the very top (first visible is depth 0)
    const firstNode = flattenedNodes[firstVisibleIndex];
    if (firstNode.depth === 0 && scrollTop < rowHeight) {
      return { stickyNodes: [], stickyHeight: 0 };
    }

    const maxWidgetHeight = viewportHeight * maxStickyHeightRatio;
    const stickyNodes: StickyScrollNode<TNode>[] = [];
    let stickyNodesHeight = 0;

    // Start from first visible node
    let currentNodeIndex = firstVisibleIndex;
    let previousStickyIndex: number | undefined = undefined;

    // Build sticky nodes by walking up the tree
    // Use a max iterations guard to satisfy linter (avoid while(true))
    const maxIterations = maxStickyItems + 1;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Find next ancestor to make sticky (index only — no allocation)
      const ancestorIdx: number | undefined = getAncestorIndexUnderPrevious(
        flattenedNodes,
        currentNodeIndex,
        previousStickyIndex
      );

      if (ancestorIdx === undefined) {
        break;
      }

      // If the ancestor is the same as the current visible node
      if (ancestorIdx === currentNodeIndex) {
        // Only include if it's an expanded parent
        if (!nodeIsUncollapsedParent(flattenedNodes, currentNodeIndex)) {
          break;
        }

        // Don't include if it aligns exactly with sticky area
        if (
          nodeTopAlignsWithStickyNodesBottom(
            currentNodeIndex,
            stickyNodesHeight,
            scrollTop,
            rowHeight
          )
        ) {
          break;
        }
      }

      const ancestorNode = flattenedNodes[ancestorIdx];

      // Create sticky node
      const { startIndex, endIndex } = getNodeRange(
        flattenedNodes,
        ancestorIdx,
        ancestorNode.depth
      );

      // Skip shallow folders: if this isn't a top-level node and has too few
      // descendants, it would flash in/out of the sticky area too quickly.
      // Stop building deeper sticky nodes — the parent stays as the last sticky.
      const descendantCount = endIndex - startIndex;
      if (stickyNodes.length > 0 && descendantCount < MIN_STICKY_DESCENDANTS) {
        break;
      }

      const position = calculateStickyNodePosition(
        endIndex,
        stickyNodesHeight,
        rowHeight,
        scrollTop,
        viewportHeight,
        flattenedNodes.length,
        rowHeight
      );

      const stickyNode: StickyScrollNode<TNode> = {
        node: ancestorNode.node,
        depth: ancestorNode.depth,
        position,
        height: rowHeight,
        startIndex,
        endIndex,
      };

      stickyNodes.push(stickyNode);
      stickyNodesHeight += rowHeight;

      // Check if we've exceeded max items
      if (stickyNodes.length >= maxStickyItems) {
        break;
      }

      // Find the next visible node under the current sticky area
      const nextVisibleTop = position + rowHeight;
      const nextVisibleIndex = Math.floor(
        (scrollTop + nextVisibleTop) / rowHeight
      );

      if (nextVisibleIndex >= flattenedNodes.length) {
        break;
      }

      // Update for next iteration
      previousStickyIndex = ancestorIdx;
      currentNodeIndex = nextVisibleIndex;
    }

    if (stickyNodes.length === 0) {
      return { stickyNodes: [], stickyHeight: 0 };
    }

    // Constrain sticky nodes
    const constrainedNodes: StickyScrollNode<TNode>[] = [];
    for (const node of stickyNodes) {
      const nodeBottom = node.position + node.height;
      if (
        constrainedNodes.length >= maxStickyItems ||
        nodeBottom > maxWidgetHeight
      ) {
        break;
      }
      constrainedNodes.push(node);
    }

    if (constrainedNodes.length === 0) {
      return { stickyNodes: [], stickyHeight: 0 };
    }

    // Calculate total height from last sticky node
    const lastNode = constrainedNodes[constrainedNodes.length - 1];
    const stickyHeight = Math.max(0, lastNode.position + lastNode.height);

    return { stickyNodes: constrainedNodes, stickyHeight };
  }, [
    flattenedNodes,
    viewportHeight,
    scrollTop,
    rowHeight,
    maxStickyItems,
    maxStickyHeightRatio,
  ]);
}
