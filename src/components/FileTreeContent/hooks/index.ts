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
