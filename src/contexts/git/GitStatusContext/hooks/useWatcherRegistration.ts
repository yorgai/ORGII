/**
 * useWatcherRegistration - Manages Rust file watcher registration for active repos
 *
 * Handles:
 * - Registering the current repo with Rust file watcher via invoke("watch_repos")
 * - Delayed registration to avoid churn during rapid repo switching
 * - Unregistering repos that are no longer active
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
  unwatchRegisteredReposExcept: (activeRepoIds: Set<string>) => void;
}

export function useWatcherRegistration({
  refs,
}: UseWatcherRegistrationOptions): UseWatcherRegistrationReturn {
  const { registeredReposRef, pendingWatcherTimeoutRef } = refs;

  const unwatchRegisteredReposExcept = useCallback(
    (activeRepoIds: Set<string>) => {
      if (pendingWatcherTimeoutRef.current) {
        clearTimeout(pendingWatcherTimeoutRef.current);
        pendingWatcherTimeoutRef.current = null;
      }

      for (const repoId of [...registeredReposRef.current]) {
        if (activeRepoIds.has(repoId)) continue;

        registeredReposRef.current.delete(repoId);
        invoke("unwatch_repo", { repoId }).catch(() => {
          // Unwatch is idempotent from the UI perspective.
        });
      }
    },
    [pendingWatcherTimeoutRef, registeredReposRef]
  );

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
        unwatchRegisteredReposExcept(new Set([repoId]));
      } catch (_error: unknown) {
        // Watcher registration failed - will retry on next repo switch
      }
    },
    [registeredReposRef, unwatchRegisteredReposExcept]
  );

  const scheduleWatcherRegistration = useCallback(
    (repoId: string, repoPath: string, repoName?: string) => {
      if (pendingWatcherTimeoutRef.current) {
        clearTimeout(pendingWatcherTimeoutRef.current);
        pendingWatcherTimeoutRef.current = null;
      }

      if (registeredReposRef.current.has(repoId)) {
        unwatchRegisteredReposExcept(new Set([repoId]));
        return;
      }

      pendingWatcherTimeoutRef.current = setTimeout(() => {
        pendingWatcherTimeoutRef.current = null;
        registerRepoWithWatcher(repoId, repoPath, repoName);
      }, WATCHER_REGISTRATION_DELAY_MS);
    },
    [
      pendingWatcherTimeoutRef,
      registeredReposRef,
      registerRepoWithWatcher,
      unwatchRegisteredReposExcept,
    ]
  );

  useEffect(() => {
    return () => {
      unwatchRegisteredReposExcept(new Set());
    };
  }, [unwatchRegisteredReposExcept]);

  return { scheduleWatcherRegistration, unwatchRegisteredReposExcept };
}
