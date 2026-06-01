import { useEffect, useState } from "react";

import { gitApi } from "@src/api/http/git";

interface UseStashCountOptions {
  repoPath: string;
  repoId: string | undefined;
}

/**
 * Fetches and maintains the stash count for a given repo.
 * Returns 0 until the first fetch resolves.
 */
export function useStashCount({
  repoPath,
  repoId,
}: UseStashCountOptions): number {
  const [stashCountsByRepo, setStashCountsByRepo] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    const effectiveRepoId = repoId || repoPath;

    void (async () => {
      const result = await gitApi.gitStashList({
        repo_id: effectiveRepoId,
        repo_path: repoPath,
      });
      if (!cancelled) {
        setStashCountsByRepo((prev) => ({
          ...prev,
          [repoPath]: result?.stashes.length ?? 0,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath, repoId]);

  return repoPath ? (stashCountsByRepo[repoPath] ?? 0) : 0;
}
