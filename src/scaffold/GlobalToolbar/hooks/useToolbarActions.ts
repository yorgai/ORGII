/**
 * useToolbarActions Hook
 *
 * Handles action callbacks for GlobalToolbar
 *
 * Features:
 * - Git status refresh (via simple GitStatusContext)
 * - Repo list preparation
 * - Branch options preparation
 *
 * SIMPLIFIED (Dec 29, 2025):
 * - Uses new simple GitStatusContext
 */
import { useCallback, useMemo } from "react";

import { useGitStatus } from "@src/contexts/git";

import type { BranchOption, RepoOption } from "../types";

// ============================================
// Type Definitions
// ============================================

export interface UseToolbarActionsOptions {
  reposList: Array<{
    id: string;
    name: string;
    repo_url?: string;
    kind?: string;
  }>;
  branchesFromManager: Array<{
    name: string;
    lastCommitDate?: string;
    isCurrent?: boolean;
    isRemote?: boolean;
  }>;
  selectedRepoId: string | null;
}

export interface UseToolbarActionsReturn {
  globalRepos: RepoOption[];
  globalBranchOptions: BranchOption[];
  handleGitStatusRefresh: () => Promise<void>;
}

// ============================================
// Hook Implementation
// ============================================

export function useToolbarActions(
  options: UseToolbarActionsOptions
): UseToolbarActionsReturn {
  const { reposList, branchesFromManager, selectedRepoId } = options;

  // Use simple GitStatusContext for refresh
  const { forceRefresh } = useGitStatus();

  // ============================================
  // Computed Values
  // ============================================

  const globalRepos = useMemo(
    () =>
      reposList.map((repo) => ({
        id: repo.id,
        name: repo.name,
        repo_url: repo.repo_url,
        kind: repo.kind,
      })),
    [reposList]
  );

  const globalBranchOptions = useMemo(
    () =>
      branchesFromManager.map((branch) => ({
        label: branch.name,
        value: branch.name,
        subLabel: branch.lastCommitDate,
      })),
    [branchesFromManager]
  );

  // ============================================
  // Event Handlers
  // ============================================

  // Handle manual git status refresh (via GitStatusContext)
  const handleGitStatusRefresh = useCallback(async () => {
    if (selectedRepoId) {
      try {
        await forceRefresh();
      } catch (err) {
        console.error("[GlobalToolbar] Failed to refresh git status:", err);
      }
    }
  }, [selectedRepoId, forceRefresh]);

  // ============================================
  // Return
  // ============================================

  return {
    globalRepos,
    globalBranchOptions,
    handleGitStatusRefresh,
  };
}

export default useToolbarActions;
