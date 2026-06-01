import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";

import type { FlattenedNode } from "../types";

export function flattenTree(nodes: TreePanelNode[]): FlattenedNode[] {
  const result: FlattenedNode[] = [];

  function flatten(nodeList: TreePanelNode[], depth: number = 0): void {
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
      const minLength = Math.min(targetParts.length, nodeParts.length);
      for (let partIndex = 1; partIndex <= minLength; partIndex++) {
        if (
          targetParts[targetParts.length - partIndex] !==
          nodeParts[nodeParts.length - partIndex]
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  });
}

export function getLookupPath(
  nodePath: string,
  repoPath: string | null,
  isMultiRoot: boolean
): string {
  if (isMultiRoot) return nodePath;
  if (!repoPath || !nodePath.startsWith(repoPath)) return nodePath;
  return nodePath.substring(repoPath.length + 1);
}
