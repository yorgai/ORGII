/**
 * useGitWorktrees
 *
 * Fetches the list of git worktrees for a repository.
 * Returns linked (non-main) worktrees only — the main worktree
 * is already displayed by the primary Source Control section.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GitWorktreeEntry } from "@src/api/http/git/types";
import { getGitWorktrees } from "@src/api/http/git/worktrees";
import { getCodeEditorWebSocket } from "@src/api/realtime/codeEditorWebSocket";
import { useMountedCleanup } from "@src/hooks/lifecycle/useMounted";
import {
  DEBOUNCE_DELAYS,
  useDebouncedCallback,
} from "@src/hooks/perf/useDebouncedCallback";

export interface UseGitWorktreesOptions {
  repoId: string;
  repoPath: string;
  enabled?: boolean;
}

export interface UseGitWorktreesResult {
  worktrees: GitWorktreeEntry[];
  hasWorktrees: boolean;
  refresh: () => Promise<void>;
}

export function useGitWorktrees({
  repoId,
  repoPath,
  enabled = true,
}: UseGitWorktreesOptions): UseGitWorktreesResult {
  const [worktrees, setWorktrees] = useState<GitWorktreeEntry[]>([]);
  const mountedRef = useRef(true);
  useMountedCleanup(mountedRef);

  const fetchWorktrees = useCallback(async () => {
    if (!enabled) return;

    try {
      const entries = await getGitWorktrees({
        repo_id: repoId,
        repo_path: repoPath,
      });
      if (!mountedRef.current) return;
      setWorktrees(entries.filter((entry) => !entry.is_main));
    } catch {
      if (mountedRef.current) setWorktrees([]);
    }
  }, [enabled, repoId, repoPath, mountedRef]);

  const debouncedFetch = useDebouncedCallback(
    () => fetchWorktrees(),
    DEBOUNCE_DELAYS.API
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const load = async () => {
      try {
        const entries = await getGitWorktrees({
          repo_id: repoId,
          repo_path: repoPath,
        });
        if (!cancelled) {
          setWorktrees(entries.filter((entry) => !entry.is_main));
        }
      } catch {
        if (!cancelled) setWorktrees([]);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, repoId, repoPath]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const websocket = getCodeEditorWebSocket();
    if (!websocket) return;

    const unsubscribe = websocket.on("repo:status_updated", (data: unknown) => {
      if (cancelled) return;
      const payload = data as { repo_id?: string };
      if (payload.repo_id === repoId) {
        debouncedFetch();
      }
    });

    return () => {
      cancelled = true;
      debouncedFetch.cancel();
      unsubscribe();
    };
  }, [enabled, repoId, debouncedFetch]);

  const visibleWorktrees = enabled ? worktrees : [];

  return {
    worktrees: visibleWorktrees,
    hasWorktrees: visibleWorktrees.length > 0,
    refresh: fetchWorktrees,
  };
}
