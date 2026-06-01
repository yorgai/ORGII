/**
 * Types for DOMTreeContent component
 */
import type { DOMTreeNode } from "@src/modules/WorkStation/Browser/hooks/useWebviewDOMTree";

/**
 * Flattened DOM node for virtualization
 */
export interface FlattenedDOMNode {
  /** The DOM node */
  node: DOMTreeNode;
  /** Depth level (0 = root/body) */
  depth: number;
}
