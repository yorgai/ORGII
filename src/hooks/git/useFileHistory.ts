/**
 * useFileHistory Hook
 *
 * Fetches Git commit history for a specific file using the Rust Git API.
 */
import { useCallback, useEffect, useState } from "react";

import { type GitCommitInfo, getGitCommits } from "@src/api/http/git";

export interface UseFileHistoryOptions {
  /** Repository ID */
  repoId: string;
  /** File path to get history for */
  filePath: string | null;
  /** Maximum number of commits to fetch */
  limit?: number;
  /** Auto-load on mount */
  autoLoad?: boolean;
  /** Callback when history loads successfully */
  onSuccess?: (commits: GitCommitInfo[]) => void;
  /** Callback when history load fails */
  onError?: (error: string) => void;
}

export interface UseFileHistoryResult {
  /** Commit history for the file */
  commits: GitCommitInfo[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh history */
  refresh: () => Promise<void>;
  /** Total count of commits */
  totalCount: number | null;
}

/**
 * Hook to fetch and manage file commit history
 */
export function useFileHistory({
  repoId,
  filePath,
  limit = 50,
  autoLoad = true,
  onSuccess,
  onError,
}: UseFileHistoryOptions): UseFileHistoryResult {
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    // Don't fetch if no file is selected
    if (!filePath) {
      setCommits([]);
      setTotalCount(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getGitCommits({
        repo_id: repoId,
        file_path: filePath,
        limit,
      });

      if (result) {
        setCommits(result.commits);
        setTotalCount(result.total_count);
        onSuccess?.(result.commits);
      } else {
        setCommits([]);
        setTotalCount(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setCommits([]);
      setTotalCount(null);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [repoId, filePath, limit, onSuccess, onError]);

  // Auto-load on mount or when dependencies change
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
  }, [autoLoad, refresh]);

  return {
    commits,
    loading,
    error,
    refresh,
    totalCount,
  };
}
