/**
 * useRepoLoader - Handles repo loading and caching
 */
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRepos } from "@src/api/tauri/repo";
import {
  REPO_STORAGE_KEYS,
  type Repo,
  cachedReposAtom,
  lastUsedRepoAtom,
  reposAtom,
  selectedRepoIdAtom,
  updateCachedRepos,
  validRepoIdsAtom,
} from "@src/store/repo";

import {
  globalLoadInProgress,
  globalReposLoaded,
  setGlobalLoadInProgress,
  setGlobalReposLoaded,
} from "./singleton";
import type { UseRepoLoaderReturn } from "./types";

export function useRepoLoader(): UseRepoLoaderReturn {
  const [repos, setRepos] = useAtom(reposAtom);
  const [selectedRepoId, setSelectedRepoId] = useAtom(selectedRepoIdAtom);
  const setValidRepoIds = useSetAtom(validRepoIdsAtom);
  const [_cachedRepos, setCachedRepos] = useAtom(cachedReposAtom);
  const setLastUsedRepo = useSetAtom(lastUsedRepoAtom);

  const [repoLoading, setRepoLoading] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(globalReposLoaded);

  const loadedReposRef = useRef(false);
  const loadingReposRef = useRef(false);
  const needsReloadRef = useRef(false);
  const isHotReloadRef = useRef(false);
  const selectedRepoIdRef = useRef(selectedRepoId);
  const loadGenerationRef = useRef(0);

  // === HOT RELOAD FIX ===
  if (repos.length > 0 && !loadedReposRef.current && !isHotReloadRef.current) {
    isHotReloadRef.current = true;
    loadedReposRef.current = true;
  }

  // === SYNC reposLoaded state ===
  useEffect(() => {
    if (repos.length > 0 && !reposLoaded) {
      setReposLoaded(true);
    }
  }, [repos.length, reposLoaded]);

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  // Detect need for reload after hot reload
  if (
    selectedRepoId &&
    repos.length === 0 &&
    !loadingReposRef.current &&
    !needsReloadRef.current
  ) {
    needsReloadRef.current = true;
    loadedReposRef.current = false;
  }

  const loadRepos = useCallback(async () => {
    if (globalLoadInProgress) {
      return;
    }

    if (globalReposLoaded && loadedReposRef.current) {
      return;
    }

    const generation = ++loadGenerationRef.current;
    setGlobalLoadInProgress(true);
    loadingReposRef.current = true;
    setRepoLoading(true);
    let loadSucceeded = false;

    try {
      const response = await getRepos();

      // Discard stale response when forceRefreshRepos() started a newer call.
      // The newer call already owns globalLoadInProgress and loadingReposRef,
      // so we only need to stop processing this response.
      if (generation !== loadGenerationRef.current) {
        return;
      }

      if (response?.data?.repos) {
        const repoList: Repo[] = response.data.repos.map((r: unknown) => {
          const repo = r as Record<string, unknown>;
          const visibility = repo.visibility as string | undefined;
          const kind = repo.kind as string | undefined;
          return {
            id: (repo.id || repo.repo_id) as string,
            name: String(repo.repo_name || repo.name || "Unknown"),
            path: repo.path as string,
            visibility:
              visibility === "public" || visibility === "private"
                ? visibility
                : undefined,
            kind: kind === "folder" ? ("folder" as const) : ("git" as const),
            fs_uri: repo.path as string,
            repo_url: repo.repo_url as string,
            description: String(repo.description || repo.desc || ""),
            branch: repo.branch as string,
            owner_user_id: repo.owner_user_id as string,
            project_collection_uuid: repo.project_collection_uuid as string,
            workspace_uuid: repo.workspace_uuid as string,
            created_at: repo.created_at as string,
            updated_at: repo.updated_at as string,
            stats: repo.stats as Repo["stats"],
          };
        });

        setRepos(repoList);
        setValidRepoIds(new Set(repoList.map((repo) => repo.id)));
        loadedReposRef.current = true;
        loadSucceeded = true;

        // Single source of truth for repo selection restoration.
        // Priority: valid session-level selection > lastUsedRepo > first repo.
        // On page refresh sessionStorage keeps the value; on app restart it's empty
        // and AuthRedirect may have eagerly set it from lastUsedRepo as a routing hint.
        const currentSelection = selectedRepoIdRef.current;
        const currentSelectionValid =
          !!currentSelection &&
          repoList.some((repo) => repo.id === currentSelection);

        if (currentSelectionValid) {
          const currentRepo = repoList.find(
            (repo) => repo.id === currentSelection
          );
          if (currentRepo) {
            setCachedRepos((prev) => updateCachedRepos(prev, currentRepo));
          }
        } else {
          const storedId = localStorage.getItem(REPO_STORAGE_KEYS.lastUsedRepo);
          let parsedId: string | null = null;
          if (storedId) {
            try {
              parsedId = JSON.parse(storedId);
            } catch {
              parsedId = storedId;
            }
          }

          const isStoredIdValid =
            !!parsedId && repoList.some((repo) => repo.id === parsedId);

          if (isStoredIdValid) {
            setSelectedRepoId(parsedId!);
            const restoredRepo = repoList.find((repo) => repo.id === parsedId);
            if (restoredRepo) {
              setCachedRepos((prev) => updateCachedRepos(prev, restoredRepo));
            }
          } else if (repoList.length > 0) {
            setSelectedRepoId(repoList[0].id);
            setLastUsedRepo(repoList[0].id);
            setCachedRepos((prev) => updateCachedRepos(prev, repoList[0]));
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[useRepoLoader] Failed to load repos:", error);

      // Clear the optimistic selectedRepoId that AuthRedirect set — it was
      // never validated against the repo list and would leave a dangling ID.
      if (repos.length === 0 && selectedRepoIdRef.current) {
        setSelectedRepoId("");
      }
    } finally {
      // Only the latest generation owns the global flags.
      // A stale call (superseded by forceRefreshRepos) must not reset them.
      if (generation === loadGenerationRef.current) {
        setRepoLoading(false);
        loadingReposRef.current = false;
        setGlobalLoadInProgress(false);

        if (loadSucceeded) {
          setReposLoaded(true);
          setGlobalReposLoaded(true);
        }
      }
    }
  }, [
    repos.length,
    setRepos,
    setValidRepoIds,
    setSelectedRepoId,
    setLastUsedRepo,
    setCachedRepos,
  ]);

  const forceRefreshRepos = useCallback(async () => {
    loadedReposRef.current = false;
    setGlobalReposLoaded(false);
    setGlobalLoadInProgress(false);
    await loadRepos();
  }, [loadRepos]);

  // Handle hot reload triggered reload
  useEffect(() => {
    if (needsReloadRef.current && !loadingReposRef.current) {
      needsReloadRef.current = false;
      loadRepos();
    }
  }, [loadRepos, selectedRepoId]);

  // Validate selectedRepoId matches localStorage on hot reload
  useEffect(() => {
    if (!isHotReloadRef.current || repos.length === 0) return;

    const storedId = localStorage.getItem(REPO_STORAGE_KEYS.lastUsedRepo);
    let parsedId: string | null = null;
    if (storedId) {
      try {
        parsedId = JSON.parse(storedId);
      } catch {
        parsedId = storedId;
      }
    }

    if (parsedId && parsedId !== selectedRepoIdRef.current) {
      if (repos.some((repo) => repo.id === parsedId)) {
        setSelectedRepoId(parsedId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos.length]);

  return {
    repoLoading,
    reposLoaded,
    loadRepos,
    forceRefreshRepos,
  };
}
