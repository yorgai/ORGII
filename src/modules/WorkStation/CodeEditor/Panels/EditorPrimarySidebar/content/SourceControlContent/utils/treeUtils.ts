/**
 * Git Source Control Tree Utilities
 *
 * Helper functions for working with git files and tree structures.
 */
import type { GitFile } from "@src/types/git/types";

import type { GitFileTreeNode } from "../components/GitFileTreeItem";

/**
 * Status priority for folder aggregation (higher = takes precedence)
 * VS Code shows the "worst" status in folder indicators
 */
const STATUS_PRIORITY: Record<GitFile["status"], number> = {
  conflict: 5,
  deleted: 4,
  modified: 3,
  renamed: 2,
  added: 1,
  ignored: 0,
};

/**
 * Get the aggregate status for a folder based on its children
 * Returns the highest priority status found
 */
function getAggregateStatus(
  nodes: GitFileTreeNode[]
): GitFile["status"] | undefined {
  let highestPriority = 0;
  let aggregateStatus: GitFile["status"] | undefined;

  for (const node of nodes) {
    if (node.type === "file" && node.file) {
      const priority = STATUS_PRIORITY[node.file.status] || 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        aggregateStatus = node.file.status;
      }
    } else if (node.type === "directory" && node.children) {
      const childStatus = getAggregateStatus(node.children);
      if (childStatus) {
        const priority = STATUS_PRIORITY[childStatus] || 0;
        if (priority > highestPriority) {
          highestPriority = priority;
          aggregateStatus = childStatus;
        }
      }
    }
  }

  return aggregateStatus;
}

/**
 * Converts flat list of git files into a hierarchical tree structure
 */
export function buildGitFileTree(files: GitFile[]): GitFileTreeNode[] {
  const root: GitFileTreeNode[] = [];
  const directoryMap = new Map<string, GitFileTreeNode>();

  // Sort files by path for consistent ordering
  const sortedFiles = [...files].sort((fileA, fileB) =>
    fileA.path.localeCompare(fileB.path)
  );

  for (const file of sortedFiles) {
    const parts = file.path.split("/");
    let currentPath = "";
    let currentLevel = root;

    // Process each directory level
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const isLastPart = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLastPart) {
        // This is the file itself
        currentLevel.push({
          type: "file",
          name: part,
          path: currentPath,
          file,
          expanded: false,
        });
      } else {
        // This is a directory
        let dirNode = directoryMap.get(currentPath);

        if (!dirNode) {
          // Create new directory node (expanded by default)
          dirNode = {
            type: "directory",
            name: part,
            path: currentPath,
            children: [],
            expanded: true,
          };
          directoryMap.set(currentPath, dirNode);
          currentLevel.push(dirNode);
        }

        // Move to the next level
        currentLevel = dirNode.children!;
      }
    }
  }

  return root;
}

/**
 * Compress single-child directory chains
 * e.g., src > page > Orgii becomes "src / page / Orgii" as single node
 */
function compressDirectoryChains(nodes: GitFileTreeNode[]): GitFileTreeNode[] {
  return nodes.map((node) => {
    if (node.type !== "directory" || !node.children) {
      return node;
    }

    // First, recursively compress children
    let compressedChildren = compressDirectoryChains(node.children);

    // Check if this directory has exactly one child that is also a directory
    while (
      compressedChildren.length === 1 &&
      compressedChildren[0].type === "directory"
    ) {
      const singleChild = compressedChildren[0];
      // Merge names with " / " separator
      node = {
        ...node,
        name: `${node.name} / ${singleChild.name}`,
        path: singleChild.path, // Use the deepest path
        children: singleChild.children,
      };
      compressedChildren = singleChild.children
        ? compressDirectoryChains(singleChild.children)
        : [];
    }

    // Calculate aggregate status for the folder
    const aggregateStatus =
      compressedChildren.length > 0
        ? getAggregateStatus(compressedChildren)
        : undefined;

    return {
      ...node,
      children: compressedChildren,
      aggregateStatus,
    };
  });
}

/**
 * Builds a hierarchical tree with path compression
 * - Proper nested directories
 * - Single-child directory chains compressed into one node
 * - Folder status aggregation
 */
export function buildVSCodeStyleTree(files: GitFile[]): GitFileTreeNode[] {
  // First build the full hierarchical tree
  const fullTree = buildGitFileTree(files);

  // Then compress single-child directory chains
  return compressDirectoryChains(fullTree);
}

/**
 * Flattens tree structure into array for rendering
 */
export function flattenGitFileTree(
  nodes: GitFileTreeNode[],
  depth: number = 0
): Array<{ node: GitFileTreeNode; depth: number }> {
  const result: Array<{ node: GitFileTreeNode; depth: number }> = [];

  for (const node of nodes) {
    result.push({ node, depth });

    // Include children if directory is expanded
    if (
      node.type === "directory" &&
      node.expanded &&
      node.children &&
      node.children.length > 0
    ) {
      result.push(...flattenGitFileTree(node.children, depth + 1));
    }
  }

  return result;
}

/**
 * Toggles expanded state of a directory node
 */
export function toggleDirectoryInTree(
  nodes: GitFileTreeNode[],
  targetPath: string
): GitFileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.type === "directory") {
      return {
        ...node,
        expanded: !node.expanded,
      };
    }

    if (node.children) {
      return {
        ...node,
        children: toggleDirectoryInTree(node.children, targetPath),
      };
    }

    return node;
  });
}
