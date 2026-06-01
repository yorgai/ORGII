/**
 * File Tree Selection Atom
 *
 * PERFORMANCE OPTIMIZATION (Jan 2026):
 * Provides efficient selection state for file tree nodes.
 *
 * Problem: React Context causes ALL TreeNodes to re-render when selectedPath changes.
 * Solution: Use Jotai selectAtom - nodes only re-render when their boolean selection changes.
 *
 * How it works:
 * 1. Tree views set `fileTreeSelectedPathAtom` when selection changes
 * 2. Each row uses `useIsFileSelected(path, name, repoPath)`
 * 3. The hook creates a derived atom that returns boolean (isSelected)
 * 4. Jotai's selectAtom compares booleans, so node only re-renders if:
 *    - It was selected and is now NOT selected, or
 *    - It was NOT selected and is now selected
 *
 * Result: When user clicks a different file, only 2 nodes re-render:
 * - The previously selected node (to remove highlight)
 * - The newly selected node (to add highlight)
 */
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";

// ============================================
// Atoms
// ============================================

/**
 * The currently selected file path in the file tree
 * Updated by tree views when selection changes
 */
export const fileTreeSelectedPathAtom = atom<string | null>(null);
fileTreeSelectedPathAtom.debugLabel = "fileTreeSelectedPathAtom";

// ============================================
// Selection Check Logic
// ============================================

/**
 * Check if a node path matches the selected path.
 * Handles both absolute and relative path formats.
 *
 * In multi-root workspaces all paths are absolute, so only exact match applies.
 * Fuzzy matching (relative paths) is only used in single-root mode where
 * repoPath is known and unambiguous.
 */
function checkIsSelected(
  selectedPath: string | null,
  nodePath: string,
  nodeName: string,
  repoPath: string | null
): boolean {
  if (!selectedPath) return false;

  // Exact match (handles both absolute and relative)
  if (selectedPath === nodePath) return true;

  // Fuzzy matching only when repoPath is set (single-root) and both paths
  // share the same root — prevents cross-root false positives in multi-root.
  if (!repoPath) return false;

  const bothUnderSameRoot =
    nodePath.startsWith(repoPath) && selectedPath.startsWith(repoPath);
  if (!bothUnderSameRoot) {
    // selectedPath might be relative — check if nodePath ends with it
    if (
      !selectedPath.startsWith("/") &&
      nodePath.endsWith(`/${selectedPath}`)
    ) {
      return true;
    }
    return false;
  }

  if (selectedPath.endsWith(`/${nodeName}`)) {
    const nodeRelative = nodePath.substring(repoPath.length + 1);
    return (
      selectedPath === nodeRelative || selectedPath.endsWith(`/${nodeRelative}`)
    );
  }

  return false;
}

// ============================================
// Hook for TreeNodes
// ============================================

/**
 * Hook to check if a file tree node is selected
 *
 * PERFORMANCE: Uses Jotai's selectAtom - only re-renders when
 * this specific node's boolean selection state changes.
 *
 * When selection changes from /path/a.ts to /path/b.ts:
 * - Node a.ts: true → false (re-render to remove highlight)
 * - Node b.ts: false → true (re-render to add highlight)
 * - All other nodes: false → false (NO re-render!)
 *
 * @param nodePath - The full path of the node
 * @param nodeName - The display name of the node
 * @param repoPath - The repository root path (for relative path matching)
 */
export function useIsFileSelected(
  nodePath: string,
  nodeName: string,
  repoPath: string | null
): boolean {
  // Create a stable selectAtom that derives boolean from the selected path
  // The atom is memoized by nodePath/nodeName/repoPath, so each node gets its own atom
  // selectAtom uses Object.is for equality, so boolean comparison is efficient
  const isSelectedAtom = useMemo(
    () =>
      selectAtom(fileTreeSelectedPathAtom, (selectedPath) =>
        checkIsSelected(selectedPath, nodePath, nodeName, repoPath)
      ),
    [nodePath, nodeName, repoPath]
  );

  // Subscribe to the derived atom - only re-renders when boolean changes
  return useAtomValue(isSelectedAtom);
}
