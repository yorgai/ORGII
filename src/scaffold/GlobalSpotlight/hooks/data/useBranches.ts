/**
 * useBranches Hook
 *
 * Lazy branch fetching per repository with centralized caching.
 * Prevents redundant API calls by using shared atom cache.
 */
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { gitApi } from "@src/api/http/git";
import { createLogger } from "@src/hooks/logger";
import {
  branchCacheAtom,
  branchLoadingRepoIdsAtom,
  getBranchesFromCache,
  isBranchCacheFresh,
  validRepoIdsAtom,
} from "@src/store/repo";
import type { Branch } from "@src/store/repo/types";

import type { BranchItem } from "../../types";
import type { UseBranchesOptions } from "../core/types";

const log = createLogger("useBranches");

// ============================================
// Return Interface
// ============================================

export interface UseBranchesReturn {
  /** Branches for the current repo */
  branches: BranchItem[];
  /** Whether branches are loading */
  isLoading: boolean;
  /** Fetch branches for a specific repo */
  fetchBranches: (repoId: string) => Promise<void>;
  /** Clear branches */
  clearBranches: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useBranches(
  options: UseBranchesOptions = { repoId: null, enabled: true }
): UseBranchesReturn {
  const { repoId, enabled = true } = options;

  const validRepoIds = useAtomValue(validRepoIdsAtom);
  const [branchCache, setBranchCache] = useAtom(branchCacheAtom);
  const [loadingRepoIds, setLoadingRepoIds] = useAtom(branchLoadingRepoIdsAtom);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  // Use refs for values that shouldn't trigger re-creation of fetchBranches
  const validRepoIdsRef = useRef(validRepoIds);
  const branchCacheRef = useRef(branchCache);
  const loadingRepoIdsRef = useRef(loadingRepoIds);

  // Keep refs up to date
  useEffect(() => {
    validRepoIdsRef.current = validRepoIds;
  }, [validRepoIds]);

  useEffect(() => {
    branchCacheRef.current = branchCache;
  }, [branchCache]);

  useEffect(() => {
    loadingRepoIdsRef.current = loadingRepoIds;
  }, [loadingRepoIds]);

  // Derive isLoading from both local fetching and global loading state
  const isLoading = isFetching || (repoId ? loadingRepoIds.has(repoId) : false);

  // Sync branches from cache whenever it changes
  useEffect(() => {
    if (!repoId) return;

    const cached = getBranchesFromCache(branchCache, repoId);
    if (cached && cached.branches.length > 0) {
      const branchList = cached.branches.map((branch) => ({
        name: branch.name,
        // Use stored isCurrent from API, fallback to currentBranch comparison
        isCurrent: branch.isCurrent ?? branch.name === cached.currentBranch,
        isRemote: branch.isRemote ?? false,
        lastCommitDate: branch.lastCommitDate,
      }));
      setBranches(branchList);
    }
  }, [repoId, branchCache]);

  // Fetch branches for a specific repo with caching
  const fetchBranches = useCallback(
    async (targetRepoId: string) => {
      // Validate repo ID is non-empty (IDs may be UUIDs or canonical fs paths)
      if (!targetRepoId) {
        return;
      }

      // Validate repo exists (use ref to avoid stale closures)
      const currentValidRepoIds = validRepoIdsRef.current;
      if (
        currentValidRepoIds.size > 0 &&
        !currentValidRepoIds.has(targetRepoId)
      ) {
        return;
      }

      // Check if already loading (use ref)
      if (loadingRepoIdsRef.current.has(targetRepoId)) {
        return;
      }

      // Check cache first (use ref)
      const currentCache = branchCacheRef.current;
      if (isBranchCacheFresh(currentCache, targetRepoId)) {
        const cached = getBranchesFromCache(currentCache, targetRepoId);
        if (cached) {
          const branchList = cached.branches.map((branch) => ({
            name: branch.name,
            // Use stored isCurrent from API, fallback to currentBranch comparison
            isCurrent: branch.isCurrent ?? branch.name === cached.currentBranch,
            isRemote: branch.isRemote ?? false,
            lastCommitDate: branch.lastCommitDate,
          }));
          setBranches(branchList);
          return;
        }
      }

      try {
        // Mark as loading
        setLoadingRepoIds((prev) => new Set(prev).add(targetRepoId));
        setIsFetching(true);
        const response = await gitApi.getGitBranches({
          repo_id: targetRepoId,
          include_remote: true,
        });

        // API returns data directly (no status/data wrapper)
        if (response?.branches) {
          const currentBranch = response.current_branch || "";
          const branchList: Branch[] = (response.branches || [])
            .filter(
              (branch: {
                name?: string;
                is_current?: boolean;
                branch_type?: string;
                last_commit_date?: string;
              }) => !!branch.name
            )
            .map(
              (branch: {
                name: string;
                is_current?: boolean;
                branch_type?: string;
                last_commit_date?: string;
              }) => ({
                name: branch.name,
                isCurrent: branch.is_current,
                isRemote: branch.branch_type === "remote",
                lastCommitDate: branch.last_commit_date,
              })
            );

          // Update cache - BranchItem now matches Branch format (both camelCase)
          setBranchCache((prev) => {
            const next = new Map(prev);
            next.set(targetRepoId, {
              branches: branchList,
              currentBranch,
              fetchedAt: Date.now(),
            });
            return next;
          });
        }
      } catch (error) {
        log.error("[useBranches] Error fetching branches:", error);
        setBranches([]);
      } finally {
        setIsFetching(false);
        // Remove from loading set
        setLoadingRepoIds((prev) => {
          const next = new Set(prev);
          next.delete(targetRepoId);
          return next;
        });
      }
    },
    [setBranchCache, setLoadingRepoIds]
  );

  // Clear branches
  const clearBranches = useCallback(() => {
    setBranches([]);
  }, []);

  // Auto-fetch if repoId is provided and enabled
  useEffect(() => {
    if (enabled && repoId) {
      fetchBranches(repoId);
    }
  }, [repoId, enabled, fetchBranches]);

  return {
    branches,
    isLoading,
    fetchBranches,
    clearBranches,
  };
}
