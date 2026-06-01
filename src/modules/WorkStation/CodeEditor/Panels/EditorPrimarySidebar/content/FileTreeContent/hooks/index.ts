/**
 * FileTreeContent Hooks
 *
 * Note: Scroll preservation and sticky scroll are now handled by
 * the reusable VirtualizedStickyTree component.
 */
export { useRevealPath } from "./useRevealPath";
export type { UseRevealPathOptions } from "./useRevealPath";

// Re-export from shared VirtualizedStickyTree for consumers that need direct access
export {
  useStickyScroll,
  useScrollPreservation,
} from "@src/components/VirtualizedStickyTree";
export type {
  StickyScrollNode,
  FlattenedTreeNode,
} from "@src/components/VirtualizedStickyTree";
