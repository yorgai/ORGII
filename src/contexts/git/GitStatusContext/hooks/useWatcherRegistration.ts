/**
 * useWatcherRegistration - Manages Rust file watcher registration for repos
 *
 * Handles:
 * - Registering repos with Rust file watcher via invoke("watch_repos")
 * - Delayed registration (2 seconds) to avoid churn during rapid repo switching
 * - Tracking which repos have been registered to avoid duplicates
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect } from "react";

import { WATCHER_REGISTRATION_DELAY_MS } from "../constants";
import type { GitStatusRefs } from "../types";

interface UseWatcherRegistrationOptions {
  refs: Pick<GitStatusRefs, "registeredReposRef" | "pendingWatcherTimeoutRef">;
}

interface UseWatcherRegistrationReturn {
  scheduleWatcherRegistration: (
    repoId: string,
    repoPath: string,
    repoName?: string
  ) => void;
}

export function useWatcherRegistration({
  refs,
}: UseWatcherRegistrationOptions): UseWatcherRegistrationReturn {
  const { registeredReposRef, pendingWatcherTimeoutRef } = refs;

  const registerRepoWithWatcher = useCallback(
    async (repoId: string, repoPath: string, repoName?: string) => {
      try {
        await invoke("watch_repos", {
          repos: [
            {
              repo_id: repoId,
              repo_path: repoPath,
              repo_name: repoName || "Unknown",
            },
          ],
        });

        registeredReposRef.current.add(repoId);
      } catch (_error: unknown) {
        // Watcher registration failed - will retry on next repo switch
      }
    },
    [registeredReposRef]
  );

  const scheduleWatcherRegistration = useCallback(
    (repoId: string, repoPath: string, repoName?: string) => {
      // Cancel any pending registration (user switched repos again)
      if (pendingWatcherTimeoutRef.current) {
        clearTimeout(pendingWatcherTimeoutRef.current);
        pendingWatcherTimeoutRef.current = null;
      }

      // Skip if already registered
      if (registeredReposRef.current.has(repoId)) {
        return;
      }

      pendingWatcherTimeoutRef.current = setTimeout(() => {
        pendingWatcherTimeoutRef.current = null;
        // Double-check the repo is still selected before registering
        registerRepoWithWatcher(repoId, repoPath, repoName);
      }, WATCHER_REGISTRATION_DELAY_MS);
    },
    [registeredReposRef, pendingWatcherTimeoutRef, registerRepoWithWatcher]
  );

  // Cleanup pending timeout on unmount
  useEffect(() => {
    return () => {
      if (pendingWatcherTimeoutRef.current) {
        clearTimeout(pendingWatcherTimeoutRef.current);
      }
    };
  }, [pendingWatcherTimeoutRef]);

  return { scheduleWatcherRegistration };
}
