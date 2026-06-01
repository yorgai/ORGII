/**
 * Types for useRepoSelection hook
 */
import type { Branch, Repo } from "@src/store/repo";

export interface UseRepoSelectionOptions {
  /** Auto-load repos on mount (default: true) */
  autoLoad?: boolean;
}

export interface UseRepoSelectionReturn {
  // Repos
  repos: Repo[];
  selectedRepoId: string;
  currentRepo: Repo | undefined;
  repoLoading: boolean;

  // Branches
  branches: Branch[];
  currentBranch: string;
  branchLoading: boolean;
  branchesLoaded: boolean; // True if full branch list is loaded (not just current branch name)
  checkoutLoading: boolean; // True while a branch checkout is in progress

  // Actions
  selectRepo: (repoId: string) => void;
  selectBranch: (branch: string) => Promise<void>;
  loadRepos: () => Promise<void>;
  forceRefreshRepos: () => Promise<void>; // Bypass cache and reload repos (for add/remove)
  refreshBranches: () => Promise<void>;
  loadBranchList: () => void; // Trigger full branch list load (for dropdown)
  isReady: boolean;
  reposLoaded: boolean; // True if repos have been loaded (even if empty)
}

export interface UseRepoLoaderReturn {
  repoLoading: boolean;
  reposLoaded: boolean;
  loadRepos: () => Promise<void>;
  forceRefreshRepos: () => Promise<void>;
}

export interface UseBranchLoaderReturn {
  branchLoading: boolean;
  branchesLoaded: boolean;
  loadBranchList: () => void;
  refreshBranches: () => Promise<void>;
  loadCurrentBranchFast: () => Promise<void>;
  resetBranchTracking: () => void;
}

export interface UseBranchCheckoutReturn {
  checkoutLoading: boolean;
  selectBranch: (branch: string) => Promise<void>;
}
