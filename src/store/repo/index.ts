/**
 * Centralized Repo Store
 *
 * Single source of truth for repo data across the application.
 * Prevents duplicate API calls and ensures consistent state.
 *
 * ## Structure
 *
 * ```
 * repo/
 * ├── types.ts       - Type definitions (Repo, Branch, CachedRepo, etc.)
 * ├── atoms.ts       - Core and persisted atoms
 * ├── derived.ts     - Derived/computed atoms
 * ├── branchCache.ts - Branch cache LRU helpers
 * ├── storage.ts     - Storage keys, persistence, reset
 * └── index.ts       - Re-exports (this file)
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import {
 *   // Types
 *   type Repo, type Branch,
 *   // Core atoms
 *   reposAtom, selectedRepoIdAtom,
 *   // Derived atoms
 *   currentRepoAtom, repoMapAtom,
 *   // Cache helpers
 *   isBranchCacheFresh, setBranchCacheWithLRU,
 *   // Storage
 *   resetRepoStore,
 * } from '@src/store/repo';
 * ```
 */

// ============================================
// Types
// ============================================

export type {
  Repo,
  Branch,
  RepoStoreState,
  CachedRepo,
  BranchCacheEntry,
  RepoKind,
} from "./types";

export { BRANCH_CACHE_CONFIG, MAX_CACHED_REPOS, REPO_KIND } from "./types";

// ============================================
// Core Atoms
// ============================================

export {
  // Repo atoms
  reposAtom,
  validRepoIdsAtom,
  // Persisted atoms (window-scoped)
  selectedRepoIdAtom,
  selectedBranchAtom,
  // Persisted atoms (global)
  lastUsedRepoAtom,
  cachedReposAtom,
  // Branch atoms
  currentBranchAtom,
  branchesAtom,
  branchCacheAtom,
  branchLoadingRepoIdsAtom,
  // Loading & error states
  repoLoadingAtom,
  branchLoadingAtom,
  repoErrorAtom,
  repoLastLoadedAtom,
  // Freshness tracking
  repoLastCheckAtom,
  repoIsFreshAtom,
  repoFilterAtom,
} from "./atoms";

// ============================================
// Derived Atoms
// ============================================

export {
  // Lookups
  repoMapAtom,
  currentRepoAtom,
  currentRepoIsGitAtom,
  isValidRepoIdAtom,
  // Filtered & search
  filteredReposAtom,
  branchOptionsAtom,
  // Stats
  repoCountAtom,
  hasReposAtom,
  isSelectedRepoValidAtom,
  reposByTypeAtom,
  repoTotalStatsAtom,
  repoAgeSecondsAtom,
  // Session repo hint
  sessionRepoHintAtom,
  // Kind-based filtering
  gitReposAtom,
  workFoldersAtom,
} from "./derived";

// ============================================
// Cache Helpers
// ============================================

export {
  updateCachedRepos,
  isBranchCacheFresh,
  getBranchesFromCache,
  setBranchCacheWithLRU,
  touchBranchCache,
  pruneBranchCache,
  getBranchCacheStats,
} from "./branchCache";

// ============================================
// Storage
// ============================================

export {
  REPO_STORAGE_KEYS,
  CACHE_INVALIDATION_KEY,
  getCacheInvalidationTimestamp,
  clearRepoStorage,
  isValidUUID,
  resetRepoStore,
  // Window tracking
  getWindowIdsForRepo,
  registerOpenedRepo,
  unregisterWindow,
  clearAllOpenedRepos,
  isMainAppWindowLabel,
} from "./storage";
