/**
 * useWorkflowCollapse Hook
 *
 * Manages collapse state for workflow branches and calculates visibility.
 * Handles complex logic for determining which nodes should be hidden when branches are collapsed.
 */
import { useCallback, useMemo, useState } from "react";

import type { FlatWorkflowNode } from "../utils/flattenWorkflow";

export interface UseWorkflowCollapseOptions {
  flatNodes: FlatWorkflowNode[];
}

export interface UseWorkflowCollapseReturn {
  collapsedBranches: Set<string>;
  branchActionCounts: Map<string, number>;
  handleToggleCollapse: (branchId: string) => void;
  isNodeCollapsed: (node: FlatWorkflowNode, nodeIndex: number) => boolean;
}

export function useWorkflowCollapse({
  flatNodes,
}: UseWorkflowCollapseOptions): UseWorkflowCollapseReturn {
  // Collapse state for branches
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(
    new Set()
  );

  // Calculate action counts for each branch (if-branches and loop-body branches)
  const branchActionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    flatNodes.forEach((node) => {
      if (node.type === "action" && node.actionInstance) {
        const { parentIfId, parentLoopId, branchType } = node.actionInstance;
        if (parentIfId && branchType) {
          const branchId = `${parentIfId}-${branchType}`;
          counts.set(branchId, (counts.get(branchId) || 0) + 1);
        } else if (parentLoopId) {
          const branchId = `${parentLoopId}-loop-body`;
          counts.set(branchId, (counts.get(branchId) || 0) + 1);
        }
      }
    });
    return counts;
  }, [flatNodes]);

  // Toggle collapse for a branch
  const handleToggleCollapse = useCallback((branchId: string) => {
    setCollapsedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        next.add(branchId);
      }
      return next;
    });
  }, []);

  // Check if a node is inside any collapsed branch
  const isNodeCollapsed = useCallback(
    (node: FlatWorkflowNode, nodeIndex: number): boolean => {
      // Don't hide the branch-label itself
      if (node.type === "branch-label") {
        // But check if this branch-label is inside a collapsed parent branch
        if (node.depth > 1) {
          // Find the parent branch by looking backwards
          for (let searchIdx = nodeIndex - 1; searchIdx >= 0; searchIdx--) {
            const prevNode = flatNodes[searchIdx];
            if (
              prevNode.type === "branch-label" &&
              prevNode.depth < node.depth
            ) {
              const parentBranchId = `${prevNode.parentActionId}-${prevNode.labelType}`;
              if (collapsedBranches.has(parentBranchId)) {
                return true;
              }
            }
          }
        }
        return false;
      }

      // For end-block nodes, only hide if they're INSIDE a collapsed branch (at deeper level)
      // End-blocks at the same depth as the collapsed branch-label should remain visible
      if (node.type === "end-block") {
        const nodeDepth = node.depth;
        // Look backwards to find collapsed branch-labels at STRICTLY SHALLOWER depth
        for (let searchIdx = nodeIndex - 1; searchIdx >= 0; searchIdx--) {
          const prevNode = flatNodes[searchIdx];
          // Only check branch-labels at shallower depth (< not <=)
          if (prevNode.type === "branch-label" && prevNode.depth < nodeDepth) {
            const branchId = `${prevNode.parentActionId}-${prevNode.labelType}`;
            if (collapsedBranches.has(branchId)) {
              return true;
            }
          }
        }
        return false;
      }

      // For action nodes, check if they or any parent is in a collapsed branch
      // Strategy: Look backwards to find the immediate containing branch-label,
      // then continue checking for collapsed parent branches only at shallower depths
      const nodeDepth = node.depth;
      let foundImmediateBranch = false;

      for (let searchIdx = nodeIndex - 1; searchIdx >= 0; searchIdx--) {
        const prevNode = flatNodes[searchIdx];

        // Found a branch-label at the same depth
        if (prevNode.type === "branch-label" && prevNode.depth === nodeDepth) {
          // Only check this if we haven't found our immediate branch yet
          if (!foundImmediateBranch) {
            const branchId = `${prevNode.parentActionId}-${prevNode.labelType}`;

            // Check if this specific branch is collapsed
            if (collapsedBranches.has(branchId)) {
              return true;
            }

            // Mark that we found our immediate branch
            // Now only check parent branches at shallower depths (ignore other same-depth branches)
            foundImmediateBranch = true;
          }
          // Skip any other branch-labels at the same depth (sibling branches)
          continue;
        }

        // Found a branch-label at shallower depth - check if it's a collapsed parent
        if (prevNode.type === "branch-label" && prevNode.depth < nodeDepth) {
          const branchId = `${prevNode.parentActionId}-${prevNode.labelType}`;
          if (collapsedBranches.has(branchId)) {
            return true;
          }
        }

        // If we've found our immediate branch and hit an end-block at the same depth,
        // we're done with this branch level, continue checking parents
        if (
          foundImmediateBranch &&
          prevNode.type === "end-block" &&
          prevNode.depth === nodeDepth
        ) {
          continue;
        }
      }

      return false;
    },
    [flatNodes, collapsedBranches]
  );

  return {
    collapsedBranches,
    branchActionCounts,
    handleToggleCollapse,
    isNodeCollapsed,
  };
}
