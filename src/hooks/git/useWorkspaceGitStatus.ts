/**
 * useWorkspaceGitStatus - Multi-root workspace git status tracking
 *
 * Registers file watchers for all workspace folders and collects
 * per-folder git status into workspaceGitStatusMapAtom.
 *
 * When the workspace has a single folder, this is a no-op
 * (the existing GitStatusProvider handles it).
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { getGitStatus } from "@src/api/http/git/status";
import { getCodeEditorWebSocket } from "@src/api/realtime/codeEditorWebSocket";
import { workspaceGitStatusMapAtom } from "@src/store/git";
import {
  isMultiRootWorkspaceAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import type { GitRepositoryStatus } from "@src/types/session/steps";

interface RegisteredFolder {
  id: string;
  path: string;
}

export function useWorkspaceGitStatus(): void {
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const setWorkspaceGitStatusMap = useSetAtom(workspaceGitStatusMapAtom);

  const registeredFoldersRef = useRef<Map<string, RegisteredFolder>>(new Map());
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerAndUnregisterWatchers = useCallback(async () => {
    if (!isMultiRoot) return;

    const currentPathSet = new Set(workspaceFolders.map((f) => f.path));

    // Unwatch folders that were removed from the workspace
    const toUnwatch: string[] = [];
    for (const [path, folder] of registeredFoldersRef.current) {
      if (!currentPathSet.has(path)) {
        toUnwatch.push(folder.id);
        registeredFoldersRef.current.delete(path);
      }
    }

    for (const folderId of toUnwatch) {
      try {
        await invoke("unwatch_repo", { repoId: folderId });
      } catch {
        // Already unwatched or manager not ready — safe to ignore
      }
    }

    // Register new folders
    const reposToRegister = workspaceFolders
      .filter((folder) => !registeredFoldersRef.current.has(folder.path))
      .map((folder) => ({
        repo_id: folder.id,
        repo_path: folder.path,
        repo_name: folder.name,
      }));

    if (reposToRegister.length === 0) return;

    try {
      await invoke("watch_repos", { repos: reposToRegister });
      for (const repo of reposToRegister) {
        registeredFoldersRef.current.set(repo.repo_path, {
          id: repo.repo_id,
          path: repo.repo_path,
        });
      }
    } catch (error) {
      console.error(
        "[useWorkspaceGitStatus] Failed to register watchers:",
        error
      );
    }
  }, [isMultiRoot, workspaceFolders]);

  // Register/unregister watchers when folders change.
  // New folders are registered immediately; the delay only applies to
  // the initial mount (avoids thrashing during rapid workspace load).
  useEffect(() => {
    if (!isMultiRoot || workspaceFolders.length <= 1) return;

    const hasRegistered = registeredFoldersRef.current.size > 0;

    if (hasRegistered) {
      registerAndUnregisterWatchers();
      return;
    }

    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
    }

    const INITIAL_DELAY_MS = 1000;
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      registerAndUnregisterWatchers();
    }, INITIAL_DELAY_MS);

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [isMultiRoot, workspaceFolders, registerAndUnregisterWatchers]);

  // Fetch initial status for each workspace folder + prune stale entries
  useEffect(() => {
    if (!isMultiRoot || workspaceFolders.length <= 1) return;

    let cancelled = false;

    const currentPaths = new Set(workspaceFolders.map((f) => f.path));
    setWorkspaceGitStatusMap((prev) => {
      let pruned = false;
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (!currentPaths.has(key)) {
          next.delete(key);
          pruned = true;
        }
      }
      return pruned ? next : prev;
    });

    const fetchAllStatuses = async () => {
      for (const folder of workspaceFolders) {
        if (cancelled) return;
        try {
          const statusData = await getGitStatus({
            repo_id: folder.id,
            repo_path: folder.path,
          });
          if (!cancelled && statusData) {
            setWorkspaceGitStatusMap((prev) => {
              const next = new Map(prev);
              next.set(folder.path, statusData as GitRepositoryStatus);
              return next;
            });
          }
        } catch {
          // Folder may not be a git repo - that's fine
        }
      }
    };

    fetchAllStatuses();

    return () => {
      cancelled = true;
    };
  }, [isMultiRoot, workspaceFolders, setWorkspaceGitStatusMap]);

  // Listen for status updates from all workspace folders
  useEffect(() => {
    if (!isMultiRoot || workspaceFolders.length <= 1) return;

    const websocket = getCodeEditorWebSocket();
    if (!websocket) return;

    let mounted = true;

    const folderPathById = new Map<string, string>();
    for (const folder of workspaceFolders) {
      folderPathById.set(folder.id, folder.path);
    }

    const unsubscribe = websocket.on("repo:status_updated", (data) => {
      if (!mounted) return;

      const payload = data as {
        repo_id?: string;
        status?: GitRepositoryStatus;
      };

      if (!payload.repo_id || !payload.status) return;

      const folderPath = folderPathById.get(payload.repo_id);
      if (!folderPath) return;

      setWorkspaceGitStatusMap((prev) => {
        const next = new Map(prev);
        next.set(folderPath, payload.status as GitRepositoryStatus);
        return next;
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isMultiRoot, workspaceFolders, setWorkspaceGitStatusMap]);
}
