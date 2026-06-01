/**
 * useRepoGitStatus Hook
 *
 * Fetches and caches git status for multiple repositories.
 * Provides git status map for use in repository lists.
 *
 * UPDATED (Dec 30, 2025): Now uses MultiRepoGitStatusContext singleton
 * instead of creating multiple fetcher instances.
 */
import { useEffect, useMemo } from "react";

import { useMultiRepoGitStatusContext } from "@src/contexts/git";

// ============ TYPES ============

export interface GitStatus {
  uncommittedFiles: number;
  ahead: number;
  behind: number;
}

export interface UseRepoGitStatusOptions {
  /** Repository IDs to fetch status for */
  repoIds: string[];
  /** Selected repo ID (fetched with higher priority) */
  selectedRepoId?: string;
  /** Whether to enable fetching */
  enabled?: boolean;
}

export interface UseRepoGitStatusReturn {
  /** Git status map (repoId -> status) */
  gitStatusMap: Record<string, GitStatus>;
  /** Attach git status to repos */
  attachGitStatus: <T extends { id: string }>(
    repos: T[]
  ) => (T & { gitStatus?: GitStatus })[];
}

// ============ HOOK IMPLEMENTATION ============

/**
 * Manages git status fetching for multiple repositories
 * Uses singleton context to prevent duplicate API calls
 */
export function useRepoGitStatus(
  options: UseRepoGitStatusOptions
): UseRepoGitStatusReturn {
  const { repoIds, selectedRepoId, enabled = true } = options;

  // Use singleton context for git status
  const { gitStatusMap: contextMap, requestRefresh } =
    useMultiRepoGitStatusContext();

  // Request refresh when enabled and repoIds change
  useEffect(() => {
    if (enabled && repoIds.length > 0) {
      requestRefresh(repoIds, selectedRepoId);
    }
  }, [enabled, repoIds, selectedRepoId, requestRefresh]);

  // Convert Map to Record for compatibility
  const gitStatusMap = useMemo(() => {
    const map: Record<string, GitStatus> = {};
    contextMap.forEach((status, repoId) => {
      map[repoId] = {
        uncommittedFiles: status.uncommittedFiles,
        ahead: status.ahead,
        behind: status.behind,
      };
    });
    return map;
  }, [contextMap]);

  // Helper to attach git status to repos
  const attachGitStatus = useMemo(
    () =>
      <T extends { id: string }>(
        repos: T[]
      ): (T & { gitStatus?: GitStatus })[] => {
        return repos.map((repo) => ({
          ...repo,
          gitStatus: gitStatusMap[repo.id],
        }));
      },
    [gitStatusMap]
  );

  return {
    gitStatusMap,
    attachGitStatus,
  };
}

export default useRepoGitStatus;
