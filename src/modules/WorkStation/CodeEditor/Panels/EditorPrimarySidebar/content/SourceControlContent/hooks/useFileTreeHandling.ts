/**
 * Hook for handling file tree building and state
 *
 * Manages:
 * - Tree structure building for staged/unstaged/conflict files
 * - Collapsed directory state
 * - Display order for multi-select
 */
import { useCallback, useMemo, useState } from "react";

import type { GitFile } from "@src/types/git/types";

import type { GitFileTreeNode } from "../components/GitFileTreeItem";
import { buildVSCodeStyleTree, flattenGitFileTree } from "../utils/treeUtils";

export interface UseFileTreeHandlingOptions {
  filteredFiles: GitFile[];
  conflictFiles: GitFile[];
  viewMode: "list-tree" | "list";
  mergeCollapsed: boolean;
  stagedCollapsed: boolean;
  changesCollapsed: boolean;
  /**
   * When `false`, omit staged files from `displayOrderFiles` so multi-select
   * keyboard navigation stays in sync with the filtered virtualized list.
   * Defaults to `true` (uncommitted view).
   */
  showStagedSection?: boolean;
  /** Same as `showStagedSection`, but for the unstaged Changes section. */
  showUnstagedSection?: boolean;
}

export interface UseFileTreeHandlingResult {
  stagedFiles: GitFile[];
  unstagedFiles: GitFile[];
  flattenedStaged: Array<{ node: GitFileTreeNode; depth: number }>;
  flattenedUnstaged: Array<{ node: GitFileTreeNode; depth: number }>;
  flattenedConflicts: Array<{ node: GitFileTreeNode; depth: number }>;
  displayOrderFiles: GitFile[];
  collapsedDirs: Set<string>;
  handleToggleDirectory: (path: string) => void;
}

export function useFileTreeHandling(
  options: UseFileTreeHandlingOptions
): UseFileTreeHandlingResult {
  const {
    filteredFiles,
    conflictFiles,
    viewMode,
    mergeCollapsed,
    stagedCollapsed,
    changesCollapsed,
    showStagedSection = true,
    showUnstagedSection = true,
  } = options;

  // Track collapsed directory paths
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  // Build a set of conflict file IDs for fast lookup
  const conflictFileIds = useMemo(
    () => new Set(conflictFiles.map((file) => file.id)),
    [conflictFiles]
  );

  // Split files into staged and unstaged, excluding conflict files
  // Conflict files are shown in the separate "Merge Changes" section
  const { stagedFiles, unstagedFiles } = useMemo(() => {
    const staged = filteredFiles.filter(
      (file) => file.staged && !conflictFileIds.has(file.id)
    );
    const unstaged = filteredFiles.filter(
      (file) => !file.staged && !conflictFileIds.has(file.id)
    );
    return { stagedFiles: staged, unstagedFiles: unstaged };
  }, [filteredFiles, conflictFileIds]);

  // Handle directory toggle
  const handleToggleDirectory = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Apply collapsed state to tree nodes
  // Using useMemo with inner function to avoid "variable used before declaration" error from React Compiler
  const applyExpandedState = useMemo(() => {
    const apply = (nodes: GitFileTreeNode[]): GitFileTreeNode[] => {
      return nodes.map((node) => {
        if (node.type === "directory") {
          return {
            ...node,
            expanded: !collapsedDirs.has(node.path),
            children: node.children ? apply(node.children) : undefined,
          };
        }
        return node;
      });
    };
    return apply;
  }, [collapsedDirs]);

  // Build tree structures for staged and unstaged files
  const stagedTreeNodes = useMemo(() => {
    if (viewMode === "list" || stagedFiles.length === 0) return [];
    return applyExpandedState(buildVSCodeStyleTree(stagedFiles));
  }, [stagedFiles, viewMode, applyExpandedState]);

  const unstagedTreeNodes = useMemo(() => {
    if (viewMode === "list" || unstagedFiles.length === 0) return [];
    return applyExpandedState(buildVSCodeStyleTree(unstagedFiles));
  }, [unstagedFiles, viewMode, applyExpandedState]);

  // Build tree structure for conflict files
  const conflictTreeNodes = useMemo(() => {
    if (viewMode === "list" || conflictFiles.length === 0) return [];
    return applyExpandedState(buildVSCodeStyleTree(conflictFiles));
  }, [conflictFiles, viewMode, applyExpandedState]);

  // Flatten trees for rendering
  const flattenedStaged = useMemo(
    () => flattenGitFileTree(stagedTreeNodes),
    [stagedTreeNodes]
  );
  const flattenedUnstaged = useMemo(
    () => flattenGitFileTree(unstagedTreeNodes),
    [unstagedTreeNodes]
  );
  const flattenedConflicts = useMemo(
    () => flattenGitFileTree(conflictTreeNodes),
    [conflictTreeNodes]
  );

  // Build display order for multi-select (respects tree structure)
  const displayOrderFiles = useMemo(() => {
    const order: GitFile[] = [];

    if (viewMode === "list-tree") {
      // Tree view: use flattened tree order
      if (!mergeCollapsed) {
        flattenedConflicts.forEach(({ node }) => {
          if (node.type === "file" && node.file) {
            order.push(node.file);
          }
        });
      }
      if (showStagedSection && !stagedCollapsed) {
        flattenedStaged.forEach(({ node }) => {
          if (node.type === "file" && node.file) {
            order.push(node.file);
          }
        });
      }
      if (showUnstagedSection && !changesCollapsed) {
        flattenedUnstaged.forEach(({ node }) => {
          if (node.type === "file" && node.file) {
            order.push(node.file);
          }
        });
      }
    } else {
      // List view: simple order
      if (!mergeCollapsed) {
        order.push(...conflictFiles);
      }
      if (showStagedSection && !stagedCollapsed) {
        order.push(...stagedFiles);
      }
      if (showUnstagedSection && !changesCollapsed) {
        order.push(...unstagedFiles);
      }
    }

    return order;
  }, [
    viewMode,
    flattenedConflicts,
    flattenedStaged,
    flattenedUnstaged,
    conflictFiles,
    stagedFiles,
    unstagedFiles,
    mergeCollapsed,
    stagedCollapsed,
    changesCollapsed,
    showStagedSection,
    showUnstagedSection,
  ]);

  return {
    stagedFiles,
    unstagedFiles,
    flattenedStaged,
    flattenedUnstaged,
    flattenedConflicts,
    displayOrderFiles,
    collapsedDirs,
    handleToggleDirectory,
  };
}
