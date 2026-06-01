/**
 * Tree Utility Functions
 */
import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";

import type { FlattenedNode } from "../types";

/**
 * Flatten tree to array for virtualization.
 * Recursively flattens expanded directories while preserving depth.
 */
export function flattenTree(nodes: TreePanelNode[]): FlattenedNode[] {
  const result: FlattenedNode[] = [];

  function flatten(nodeList: TreePanelNode[], depth: number = 0) {
    for (const node of nodeList) {
      result.push({ node, depth });
      if (node.type === "directory" && node.expanded && node.children) {
        flatten(node.children, depth + 1);
      }
    }
  }

  flatten(nodes);
  return result;
}

/**
 * Find file index in flattened nodes.
 * Handles both absolute and relative path matching.
 */
export function findFileInNodes(
  nodes: FlattenedNode[],
  targetPath: string
): number {
  return nodes.findIndex((item) => {
    const nodePath = item.node.path;
    if (nodePath === targetPath) return true;
    if (nodePath.endsWith(`/${targetPath}`)) return true;
    if (targetPath.endsWith(`/${item.node.name}`)) {
      const targetParts = targetPath.split("/");
      const nodeParts = nodePath.split("/");
      const minLen = Math.min(targetParts.length, nodeParts.length);
      for (let idx = 1; idx <= minLen; idx++) {
        if (
          targetParts[targetParts.length - idx] !==
          nodeParts[nodeParts.length - idx]
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  });
}
