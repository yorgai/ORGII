import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef } from "react";

import * as repoApi from "@src/api/tauri/repo";
import { createLogger } from "@src/hooks/logger";
import { REPO_KIND, type Repo } from "@src/store/repo";
import { isTauriDesktop } from "@src/util/platform/tauri";

const log = createLogger("useRecentFolderEvents");

interface UseRecentFolderEventsOptions {
  repos: Repo[];
  selectRepo: (repoId: string) => void;
  forceRefreshRepos: () => Promise<void>;
  addWorkspaceFolder?: (path: string) => void;
  resetWorkspaceFolders?: () => void;
  onSaveWorkspaceAs?: () => void;
  onOpenWorkspaceFile?: () => void;
  onCloseWorkspace?: () => void;
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function findRepoByPath(repos: Repo[], folderPath: string): Repo | undefined {
  const normalizedTargetPath = normalizeRepoPath(folderPath);
  return repos.find((repo) => {
    const repoPath = repo.fs_uri || repo.path;
    if (!repoPath) {
      return false;
    }
    return normalizeRepoPath(repoPath) === normalizedTargetPath;
  });
}

function mapApiRepoToStoreRepo(
  apiRepo: Record<string, unknown>
): Repo | undefined {
  const repoId = apiRepo.repo_id || apiRepo.id;
  const repoPath = apiRepo.path;
  if (typeof repoId !== "string" || typeof repoPath !== "string") {
    return undefined;
  }

  return {
    id: repoId,
    name: typeof apiRepo.name === "string" ? apiRepo.name : "Unknown",
    path: repoPath,
    fs_uri: repoPath,
    kind: apiRepo.kind === "folder" ? REPO_KIND.FOLDER : REPO_KIND.GIT,
  };
}

async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

export function useRecentFolderEvents({
  repos,
  selectRepo,
  forceRefreshRepos,
  addWorkspaceFolder,
  resetWorkspaceFolders,
  onSaveWorkspaceAs,
  onOpenWorkspaceFile,
  onCloseWorkspace,
}: UseRecentFolderEventsOptions): void {
  const reposRef = useRef(repos);
  const selectRepoRef = useRef(selectRepo);
  const forceRefreshReposRef = useRef(forceRefreshRepos);
  const addWorkspaceFolderRef = useRef(addWorkspaceFolder);
  const resetWorkspaceFoldersRef = useRef(resetWorkspaceFolders);
  const onSaveWorkspaceAsRef = useRef(onSaveWorkspaceAs);
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  const onCloseWorkspaceRef = useRef(onCloseWorkspace);

  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);

  useEffect(() => {
    selectRepoRef.current = selectRepo;
  }, [selectRepo]);

  useEffect(() => {
    forceRefreshReposRef.current = forceRefreshRepos;
  }, [forceRefreshRepos]);

  useEffect(() => {
    addWorkspaceFolderRef.current = addWorkspaceFolder;
  }, [addWorkspaceFolder]);

  useEffect(() => {
    resetWorkspaceFoldersRef.current = resetWorkspaceFolders;
  }, [resetWorkspaceFolders]);

  useEffect(() => {
    onSaveWorkspaceAsRef.current = onSaveWorkspaceAs;
  }, [onSaveWorkspaceAs]);

  useEffect(() => {
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile;
  }, [onOpenWorkspaceFile]);

  useEffect(() => {
    onCloseWorkspaceRef.current = onCloseWorkspace;
  }, [onCloseWorkspace]);

  const openRecentFolder = useCallback(async (candidatePath: string) => {
    const folderPath = candidatePath.trim();
    if (!folderPath) {
      return;
    }

    if (!(await isDirectoryPath(folderPath))) {
      return;
    }

    // "Open Folder" replaces the workspace (resets multi-root to single)
    resetWorkspaceFoldersRef.current?.();

    const existingRepo = findRepoByPath(reposRef.current, folderPath);
    if (existingRepo) {
      selectRepoRef.current(existingRepo.id);
      return;
    }

    // If local state has not loaded yet, check backend repo list before importing.
    if (reposRef.current.length === 0) {
      try {
        const serverReposResponse = await repoApi.getRepos();
        const serverRepos = (serverReposResponse?.data?.repos || [])
          .map((repo) =>
            mapApiRepoToStoreRepo(repo as unknown as Record<string, unknown>)
          )
          .filter((repo): repo is Repo => Boolean(repo));
        const existingServerRepo = findRepoByPath(serverRepos, folderPath);
        if (existingServerRepo) {
          await forceRefreshReposRef.current();
          selectRepoRef.current(existingServerRepo.id);
          return;
        }
      } catch (error) {
        log.error(
          "[useRecentFolderEvents] Failed to resolve repo from backend list:",
          error
        );
      }
    }

    try {
      const importResponse = await repoApi.importLocalRepo({
        fs_path: folderPath,
      });
      await forceRefreshReposRef.current();

      const importedRepoId = importResponse.data.repo_id;
      setTimeout(() => {
        selectRepoRef.current(importedRepoId);
      }, 0);
    } catch (error) {
      log.error("[useRecentFolderEvents] Failed to open recent folder:", error);
    }
  }, []);

  const addFolderToWorkspace = useCallback(async () => {
    const selectedPath = await open({
      directory: true,
      multiple: false,
    });
    if (!selectedPath || typeof selectedPath !== "string") return;

    const folderPath = selectedPath.trim();
    if (!folderPath) return;
    if (!(await isDirectoryPath(folderPath))) return;

    addWorkspaceFolderRef.current?.(folderPath);

    // Import the folder as a repo if not already known (for git tracking),
    // but don't change the selected repo — the user is adding, not switching.
    const existingRepo = findRepoByPath(reposRef.current, folderPath);
    if (existingRepo) return;

    try {
      await repoApi.importLocalRepo({ fs_path: folderPath });
      await forceRefreshReposRef.current();
    } catch (error) {
      log.error(
        "[useRecentFolderEvents] Failed to import workspace folder:",
        error
      );
    }
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) {
      return;
    }

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setupListeners = async () => {
      const unlistenOpenRecent = await listen<string>(
        "menu-open-recent",
        (event) => {
          if (cancelled) {
            return;
          }
          openRecentFolder(event.payload);
        }
      );
      unlisteners.push(unlistenOpenRecent);

      const unlistenMacOpenFiles = await listen<string[]>(
        "macos-open-files",
        (event) => {
          if (cancelled) {
            return;
          }

          const openedPaths = event.payload;
          (async () => {
            for (const openedPath of openedPaths) {
              if (cancelled) {
                return;
              }
              await openRecentFolder(openedPath);
            }
          })();
        }
      );
      unlisteners.push(unlistenMacOpenFiles);

      const unlistenOpenFolder = await listen("menu-file-open-folder", () => {
        if (cancelled) {
          return;
        }

        (async () => {
          const selectedPath = await open({
            directory: true,
            multiple: false,
          });
          if (cancelled || !selectedPath || typeof selectedPath !== "string") {
            return;
          }
          await openRecentFolder(selectedPath);
        })();
      });
      unlisteners.push(unlistenOpenFolder);

      const unlistenAddFolder = await listen(
        "menu-add-folder-to-workspace",
        () => {
          if (cancelled) return;
          addFolderToWorkspace();
        }
      );
      unlisteners.push(unlistenAddFolder);

      const unlistenSaveWorkspaceAs = await listen(
        "menu-save-workspace-as",
        () => {
          if (cancelled) return;
          onSaveWorkspaceAsRef.current?.();
        }
      );
      unlisteners.push(unlistenSaveWorkspaceAs);

      const unlistenOpenWorkspaceFile = await listen(
        "menu-open-workspace-file",
        () => {
          if (cancelled) return;
          onOpenWorkspaceFileRef.current?.();
        }
      );
      unlisteners.push(unlistenOpenWorkspaceFile);

      const unlistenCloseWorkspace = await listen(
        "menu-close-workspace",
        () => {
          if (cancelled) return;
          onCloseWorkspaceRef.current?.();
        }
      );
      unlisteners.push(unlistenCloseWorkspace);
    };

    setupListeners().catch((error) => {
      log.error(
        "[useRecentFolderEvents] Failed to setup recent folder listeners:",
        error
      );
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => {
        unlisten();
      });
    };
  }, [openRecentFolder, addFolderToWorkspace]);
}
