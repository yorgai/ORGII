/**
 * VirtualizedStickyTree Types
 *
 * Generic types for virtualized tree with VS Code-style sticky scroll.
 */
import type { MutableRefObject, ReactNode, RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

/**
 * Base interface for tree nodes.
 * Your node type must extend this.
 */
export interface TreeNodeBase {
  /** Unique identifier/path for the node */
  path: string;
  /** Display name */
  name: string;
  /** Whether the node is a folder */
  isFolder?: boolean;
  /** Whether folder is expanded (only for folders) */
  expanded?: boolean;
}

/**
 * Flattened node with depth information
 */
export interface FlattenedTreeNode<TNode extends TreeNodeBase> {
  node: TNode;
  depth: number;
}

/**
 * Sticky scroll node with position data
 */
export interface StickyScrollNode<TNode extends TreeNodeBase> {
  node: TNode;
  depth: number;
  /** Position from top of sticky container (can be negative for clipping) */
  position: number;
  /** Height of this row */
  height: number;
  /** Start index in flattened list */
  startIndex: number;
  /** End index (last descendant) in flattened list */
  endIndex: number;
}

/**
 * Props for the main VirtualizedStickyTree component
 */
export interface VirtualizedStickyTreeProps<TNode extends TreeNodeBase> {
  /** Flattened tree nodes with depth */
  flattenedNodes: FlattenedTreeNode<TNode>[];

  /** Height of each row in pixels */
  rowHeight: number;

  /** Render function for each tree item */
  renderItem: (item: FlattenedTreeNode<TNode>, index: number) => ReactNode;

  /** Render function for sticky header items. Omit to disable sticky headers. */
  renderStickyItem?: (
    stickyNode: StickyScrollNode<TNode>,
    onClick: () => void
  ) => ReactNode;

  /** Called when a sticky header is clicked */
  onStickyHeaderClick?: (path: string, node: TNode) => void;

  /** Maximum number of sticky items */
  maxStickyItems?: number;

  /** Maximum viewport ratio for sticky area (0-1) */
  maxStickyHeightRatio?: number;

  /** Overscan for virtualization */
  overscan?: number;

  /** Viewport buffer */
  increaseViewportBy?: { top: number; bottom: number };

  /** CSS class for container */
  className?: string;

  /** Tailwind bg class for sticky headers. Defaults to bg-workstation-bg. */
  stickyBgClass?: string;

  /** Loading state */
  loading?: boolean;

  /** Error message */
  error?: string | null;

  /** Empty state message */
  emptyMessage?: string;

  /** Ref to expose Virtuoso handle */
  virtuosoRef?: RefObject<VirtuosoHandle | null>;

  /** Called when scrolling near the end of the list */
  onEndReached?: () => void;
}

/**
 * Options for useStickyScroll hook
 */
export interface UseStickyScrollOptions<TNode extends TreeNodeBase> {
  flattenedNodes: FlattenedTreeNode<TNode>[];
  viewportHeight: number;
  scrollTop: number;
  rowHeight: number;
  maxStickyItems?: number;
  maxStickyHeightRatio?: number;
}

/**
 * Return type for useStickyScroll hook
 */
export interface UseStickyScrollReturn<TNode extends TreeNodeBase> {
  stickyNodes: StickyScrollNode<TNode>[];
  stickyHeight: number;
}

/**
 * Options for useScrollPreservation hook
 */
export interface UseScrollPreservationOptions<TNode extends TreeNodeBase> {
  flattenedNodes: FlattenedTreeNode<TNode>[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  lastScrollTopRef: MutableRefObject<number>;
  rowHeight: number;
  /** Direct ref to the Virtuoso scroll container DOM element.
   *  Used for precise scrollTop adjustment after scrollToIndex.
   *  Eliminates the need for document.querySelector(".scrollbar-hide"). */
  scrollerDomRef: MutableRefObject<HTMLDivElement | null>;
}

/**
 * Scroll anchor with delta tracking (VSCode pattern)
 * Tracks both the path AND the pixel offset from viewport top
 */
export interface ScrollAnchor {
  /** Path of the anchored element */
  path: string;
  /** Pixel offset from viewport top (can be negative if partially scrolled out) */
  deltaFromTop: number;
}

/**
 * Return type for useScrollPreservation hook
 */
export interface UseScrollPreservationReturn {
  /** Update the scroll anchor - call this during scroll events */
  updateAnchor: () => void;
  /** Whether restoration is in progress (skip anchor updates during this) */
  isRestoringRef: MutableRefObject<boolean>;
}

/**
 * Props for StickyHeadersContainer
 */
export interface StickyHeadersContainerProps<TNode extends TreeNodeBase> {
  stickyNodes: StickyScrollNode<TNode>[];
  stickyHeight: number;
  renderStickyItem: (
    stickyNode: StickyScrollNode<TNode>,
    onClick: () => void
  ) => ReactNode;
  onHeaderClick: (path: string, node: TNode) => void;
  showShadow?: boolean;
  showIndentGuides?: boolean;
  /** Tailwind bg class for the sticky container and rows. Defaults to bg-workstation-bg. */
  stickyBgClass?: string;
}
