/**
 * Utility functions for DOMTreeContent
 */
import type { DOMTreeNode } from "@src/modules/WorkStation/Browser/hooks/useWebviewDOMTree";

import type { FlattenedDOMNode } from "./types";

/**
 * Flatten a DOM tree into an array for virtualization.
 * Only includes nodes whose parents are expanded.
 */
export function flattenDOMTree(
  tree: DOMTreeNode | null,
  expandedNodes: Set<string>
): FlattenedDOMNode[] {
  if (!tree) return [];

  const result: FlattenedDOMNode[] = [];

  function traverse(node: DOMTreeNode, depth: number): void {
    result.push({ node, depth });

    // Only traverse children if expanded
    if (expandedNodes.has(node.xpath) && node.children.length > 0) {
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(tree, 0);
  return result;
}

/**
 * Find the index of a node by xpath in a flattened list
 */
export function findNodeIndex(
  flattenedNodes: FlattenedDOMNode[],
  xpath: string
): number {
  return flattenedNodes.findIndex((item) => item.node.xpath === xpath);
}

/**
 * Get all parent xpaths for a given xpath
 */
export function getParentXpaths(xpath: string): string[] {
  const paths: string[] = [];
  const parts = xpath.split("/").filter(Boolean);

  let current = "";
  for (let index = 0; index < parts.length - 1; index++) {
    current += "/" + parts[index];
    paths.push(current);
  }

  return paths;
}
