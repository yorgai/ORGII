/**
 * useRepoState Hook
 *
 * Read-only hook for repository and branch state.
 * Use this when you only need to READ state, not modify it.
 *
 * PERFORMANCE: This hook is much lighter than useRepoSelection because:
 * - No API calls or loading logic
 * - No persistence logic
 * - Simple atom reads only
 *
 * For write operations (changing selection, loading repos), use useRepoSelection.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { currentRepo, currentBranch, repos } = useRepoState();
 *
 *   return (
 *     <div>
 *       <p>Repo: {currentRepo?.name}</p>
 *       <p>Branch: {currentBranch}</p>
 *     </div>
 *   );
 * }
 * ```
 */
import { useAtomValue } from "jotai";

import {
  Branch,
  Repo,
  branchLoadingAtom,
  branchesAtom,
  currentBranchAtom,
  currentRepoAtom,
  filteredReposAtom,
  repoLoadingAtom,
  reposAtom,
  selectedRepoIdAtom,
  validRepoIdsAtom,
} from "@src/store/repo";

// ============================================
// Types
// ============================================

export interface UseRepoStateReturn {
  /** All available repositories */
  repos: Repo[];

  /** Filtered repositories (based on search filter) */
  filteredRepos: Repo[];

  /** Currently selected repository ID */
  selectedRepoId: string;

  /** Currently selected repository object */
  currentRepo: Repo | undefined;

  /**
   * Selected branch - now returns currentBranch for consistency
   * @deprecated Use currentBranch instead
   */
  selectedBranch: string;

  /** Current branch from git (actual) - THE source of truth */
  currentBranch: string;

  /** List of branches for current repo */
  branches: Branch[];

  /** Whether repos are loading */
  repoLoading: boolean;

  /** Whether branches are loading */
  branchLoading: boolean;

  /** Set of valid repo IDs (for validation) */
  validRepoIds: Set<string>;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Read-only hook for repo/branch state
 *
 * Use this in components that only need to display repo/branch info.
 * Example: TabManager
 */
export function useRepoState(): UseRepoStateReturn {
  // Core state
  const repos = useAtomValue(reposAtom);
  const filteredRepos = useAtomValue(filteredReposAtom);
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const currentRepo = useAtomValue(currentRepoAtom);

  // Branch state - currentBranch is the SINGLE source of truth
  const currentBranch = useAtomValue(currentBranchAtom);
  const branches = useAtomValue(branchesAtom);

  // Loading state
  const repoLoading = useAtomValue(repoLoadingAtom);
  const branchLoading = useAtomValue(branchLoadingAtom);

  // Validation
  const validRepoIds = useAtomValue(validRepoIdsAtom);

  return {
    repos,
    filteredRepos,
    selectedRepoId,
    currentRepo,
    // selectedBranch now returns currentBranch for consistency
    selectedBranch: currentBranch,
    currentBranch,
    branches,
    repoLoading,
    branchLoading,
    validRepoIds,
  };
}

export default useRepoState;
