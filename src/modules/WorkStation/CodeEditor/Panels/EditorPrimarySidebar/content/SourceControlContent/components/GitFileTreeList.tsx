/**
 * GitFileTreeList Component
 *
 * A reusable file tree list component that renders GitFile[] as a VS Code style tree.
 * Handles tree building, flattening, and directory expand/collapse state internally.
 *
 * Use this component when you need to display a list of git files in tree format.
 */
import React, { useCallback, useMemo, useState } from "react";

import type { GitFile } from "@src/types/git/types";

import { buildVSCodeStyleTree, flattenGitFileTree } from "../utils/treeUtils";
import type { GitFileTreeNode } from "./GitFileTreeItem";
import GitFileTreeItem from "./GitFileTreeItem";

export interface GitFileTreeListProps {
  /** List of git files to display */
  files: GitFile[];
  /** Currently selected file ID */
  selectedFileId?: string;
  /** Callback when a file is selected */
  onSelect: (fileId: string, event?: React.MouseEvent) => void;
  /** Optional callback for stage/unstage action */
  onStageToggle?: (fileId: string, stage: boolean) => Promise<void> | void;
  /** Optional callback for discard action */
  onDiscard?: (fileId: string) => Promise<void> | void;
  /** Whether files are conflict files (shows different action button) */
  isConflictMode?: boolean;
  /** Optional className for the container */
  className?: string;
}

const GitFileTreeList: React.FC<GitFileTreeListProps> = ({
  files,
  selectedFileId = "",
  onSelect,
  onStageToggle,
  onDiscard,
  isConflictMode = false,
  className,
}) => {
  // Track collapsed directories (all expanded by default)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  // Build tree structure from files (pure computation)
  const treeNodes: GitFileTreeNode[] = useMemo(() => {
    if (files.length === 0) return [];
    const tree = buildVSCodeStyleTree(files);

    // Apply collapsed state to tree nodes
    const applyCollapsedState = (
      nodes: GitFileTreeNode[]
    ): GitFileTreeNode[] => {
      return nodes.map((node) => {
        if (node.type === "directory") {
          return {
            ...node,
            expanded: !collapsedPaths.has(node.path),
            children: node.children
              ? applyCollapsedState(node.children)
              : undefined,
          };
        }
        return node;
      });
    };

    return applyCollapsedState(tree);
  }, [files, collapsedPaths]);

  // Flatten tree for rendering (respecting expanded state)
  const flattenedTree = useMemo(
    () => flattenGitFileTree(treeNodes),
    [treeNodes]
  );

  // Handle directory toggle
  const handleToggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {flattenedTree.map(({ node, depth }) => (
        <GitFileTreeItem
          key={node.path}
          node={node}
          depth={depth}
          selectedFileId={selectedFileId}
          onSelect={onSelect}
          onStageToggle={onStageToggle}
          onDiscard={onDiscard}
          onToggleDirectory={handleToggleDirectory}
          isConflictFile={isConflictMode}
        />
      ))}
    </div>
  );
};

GitFileTreeList.displayName = "GitFileTreeList";

export default GitFileTreeList;
