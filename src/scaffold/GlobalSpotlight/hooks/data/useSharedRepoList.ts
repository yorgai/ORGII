/**
 * useSharedRepoList Hook
 *
 * Single source of truth for repo listing UI across the main Spotlight
 * and the RepoSelector. Handles:
 *   - reading repos from the central repo store (via lightweight useRepoState)
 *   - attaching git status via the singleton context
 *   - search filtering
 *   - exposing repoLoading / forceRefresh for write consumers
 *
 * Consumers decide how to render (items adapter, tabs, etc.); this hook
 * only owns the data pipeline.
 */
import { useCallback, useMemo } from "react";

import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useRepoState } from "@src/hooks/git/useRepoState";
import { useFilteredItems } from "@src/hooks/search";

import type { RepoItem } from "../../types";
import { type GitStatus, useRepoGitStatus } from "../useRepoGitStatus";

// ============================================
// Types
// ============================================

export interface UseSharedRepoListOptions {
  /** Whether to enable git status fetching */
  enabled: boolean;
  /** Currently selected repo ID (prioritized by git status fetch) */
  currentRepoId?: string;
  /** Free-text search query */
  searchQuery: string;
}

export interface UseSharedRepoListReturn {
  /** Raw repos mapped to the spotlight RepoItem shape */
  repos: RepoItem[];
  /** Repos with git status attached */
  reposWithGitStatus: (RepoItem & { gitStatus?: GitStatus })[];
  /** Filtered (by searchQuery) repos with git status */
  filteredRepos: (RepoItem & { gitStatus?: GitStatus })[];
  /** Whether repos are currently being loaded */
  repoLoading: boolean;
  /** Load repos (respects cache) */
  loadRepos: () => Promise<void>;
  /** Force-refresh the repo list (bypasses cache) */
  refreshReposForce: () => Promise<void>;
}

// ============================================
// Hook Implementation
// ============================================

export function useSharedRepoList(
  options: UseSharedRepoListOptions
): UseSharedRepoListReturn {
  const { enabled, currentRepoId, searchQuery } = options;

  const { repos: centralRepos, repoLoading } = useRepoState();
  const { loadRepos: loadReposInternal, forceRefreshRepos } = useRepoSelection({
    autoLoad: false,
  });

  const repos: RepoItem[] = useMemo(
    () =>
      centralRepos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        repo_url: repo.repo_url,
        branch: repo.branch,
        fs_uri: repo.fs_uri,
        workspace_uuid: repo.workspace_uuid,
        kind: repo.kind,
      })),
    [centralRepos]
  );

  const repoIds = useMemo(() => repos.map((repo) => repo.id), [repos]);

  const { attachGitStatus } = useRepoGitStatus({
    repoIds,
    selectedRepoId: currentRepoId,
    enabled,
  });

  const reposWithGitStatus = useMemo(
    () => attachGitStatus(repos),
    [repos, attachGitStatus]
  );

  const { filteredItems: filteredRepos } = useFilteredItems({
    items: reposWithGitStatus,
    searchQuery,
    getSearchText: (repo) => repo.name,
  });

  const loadRepos = useCallback(async () => {
    await loadReposInternal();
  }, [loadReposInternal]);

  const refreshReposForce = useCallback(async () => {
    await forceRefreshRepos();
  }, [forceRefreshRepos]);

  return {
    repos,
    reposWithGitStatus,
    filteredRepos,
    repoLoading,
    loadRepos,
    refreshReposForce,
  };
}

export default useSharedRepoList;
