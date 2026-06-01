import { useCallback, useEffect, useState } from "react";

import { repoApi } from "@src/api/tauri/repo";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("RepoGitInitialization");

export type RepoGitInitializationState = boolean | null;

export interface UseRepoGitInitializationReturn {
  isGitInitialized: RepoGitInitializationState;
  refreshGitInitialization: () => Promise<void>;
}

export function useRepoGitInitialization(
  repoPath: string | null | undefined
): UseRepoGitInitializationReturn {
  const [isGitInitialized, setIsGitInitialized] =
    useState<RepoGitInitializationState>(null);

  const refreshGitInitialization = useCallback(async () => {
    if (!repoPath) {
      setIsGitInitialized(null);
      return;
    }

    try {
      const result = await repoApi.checkIsGitRepo(repoPath);
      setIsGitInitialized(result);
    } catch (error) {
      logger.warn("Failed to check Git initialization:", error, { repoPath });
      setIsGitInitialized(false);
    }
  }, [repoPath]);

  useEffect(() => {
    let cancelled = false;

    async function checkGitInitialization() {
      if (!repoPath) {
        setIsGitInitialized(null);
        return;
      }

      setIsGitInitialized(null);
      try {
        const result = await repoApi.checkIsGitRepo(repoPath);
        if (!cancelled) setIsGitInitialized(result);
      } catch (error) {
        logger.warn("Failed to check Git initialization:", error, { repoPath });
        if (!cancelled) setIsGitInitialized(false);
      }
    }

    void checkGitInitialization();

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  return { isGitInitialized, refreshGitInitialization };
}
