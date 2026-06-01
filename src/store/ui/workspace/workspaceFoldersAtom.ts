/**
 * Workspace Folders Atoms
 *
 * Multi-root workspace support: manages an ordered list of workspace folder roots.
 * Syncs with the existing single-repo model (currentRepoAtom / selectedRepoIdAtom)
 * so that the primary folder acts as the "selected repo".
 */
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

import { autoSaveWorkspace } from "@src/services/workspace";
import type { WorkspaceFolder } from "@src/types/workspace";
import { getWindowId } from "@src/util/core/state/windowScopedState";

// ============================================
// Core Atom (window-scoped session storage)
// ============================================

function getWindowScopedKey(baseKey: string): string {
  return `${baseKey}:${getWindowId()}`;
}

/**
 * Ordered list of workspace folder roots.
 * Persisted in sessionStorage (window-scoped) so each window has its own workspace.
 */
export const workspaceFoldersAtom = atomWithStorage<WorkspaceFolder[]>(
  getWindowScopedKey("workspaceFolders"),
  [],
  createJSONStorage(() => sessionStorage),
  { getOnInit: true }
);
workspaceFoldersAtom.debugLabel = "workspaceFoldersAtom";

/**
 * Whether the workspace is multi-root (more than one folder).
 */
export const isMultiRootWorkspaceAtom = atom<boolean>((get) => {
  return get(workspaceFoldersAtom).length > 1;
});
isMultiRootWorkspaceAtom.debugLabel = "isMultiRootWorkspaceAtom";

/**
 * Path to the .soyd-workspace config file (null if untitled/unsaved).
 */
export const workspaceConfigPathAtom = atom<string | null>(null);
workspaceConfigPathAtom.debugLabel = "workspaceConfigPathAtom";

/**
 * Whether the workspace has unsaved changes.
 */
export const workspaceDirtyAtom = atom<boolean>(false);
workspaceDirtyAtom.debugLabel = "workspaceDirtyAtom";

// ============================================
// Derived Atoms
// ============================================

/**
 * The primary workspace folder (first folder, or the one marked isPrimary).
 * Used as the default project_path for agents and git operations.
 */
export const primaryWorkspaceFolderAtom = atom<WorkspaceFolder | undefined>(
  (get) => {
    const folders = get(workspaceFoldersAtom);
    return folders.find((folder) => folder.isPrimary) ?? folders[0];
  }
);
primaryWorkspaceFolderAtom.debugLabel = "primaryWorkspaceFolderAtom";

/**
 * All workspace folder paths (convenience for iteration).
 */
export const workspaceFolderPathsAtom = atom<string[]>((get) => {
  return get(workspaceFoldersAtom).map((folder) => folder.path);
});
workspaceFolderPathsAtom.debugLabel = "workspaceFolderPathsAtom";

// ============================================
// Write Atoms (actions)
// ============================================

/**
 * Add a folder to the workspace. Deduplicates by path.
 * First folder added becomes primary.
 */
export const addWorkspaceFolderAtom = atom(
  null,
  (get, set, payload: { path: string; name?: string }) => {
    const folders = get(workspaceFoldersAtom);
    const stripped = payload.path.startsWith("file://")
      ? payload.path.replace("file://", "")
      : payload.path;
    const normalizedPath = stripped.replace(/\/+$/, "");

    const alreadyExists = folders.some(
      (folder) => folder.path.replace(/\/+$/, "") === normalizedPath
    );
    if (alreadyExists) return;

    const folderName =
      payload.name ?? normalizedPath.split("/").pop() ?? normalizedPath;

    const newFolder: WorkspaceFolder = {
      id: crypto.randomUUID(),
      name: folderName,
      path: normalizedPath,
      uri: `file://${normalizedPath}`,
      isPrimary: folders.length === 0,
    };

    const updated = [...folders, newFolder];
    set(workspaceFoldersAtom, updated);
    set(workspaceDirtyAtom, true);
    void autoSaveWorkspace(updated);
  }
);
addWorkspaceFolderAtom.debugLabel = "addWorkspaceFolderAtom";

/**
 * Remove a folder from the workspace by id.
 * If the primary folder is removed, the next folder becomes primary.
 */
export const removeWorkspaceFolderAtom = atom(
  null,
  (get, set, folderId: string) => {
    const folders = get(workspaceFoldersAtom);
    const removedFolder = folders.find((folder) => folder.id === folderId);
    if (!removedFolder) return;

    let remaining = folders.filter((folder) => folder.id !== folderId);

    if (removedFolder.isPrimary && remaining.length > 0) {
      remaining = remaining.map((folder, index) =>
        index === 0 ? { ...folder, isPrimary: true } : folder
      );
    }

    set(workspaceFoldersAtom, remaining);
    set(workspaceDirtyAtom, true);
    void autoSaveWorkspace(remaining);
  }
);
removeWorkspaceFolderAtom.debugLabel = "removeWorkspaceFolderAtom";

/**
 * Replace all workspace folders (used when loading a .soyd-workspace file
 * or resetting to single-root). Auto-saves to disk so the on-disk state
 * matches the in-memory state — particularly important when going from
 * multi-root back to single-root (cleans up the stale auto-save file).
 */
export const setWorkspaceFoldersAtom = atom(
  null,
  (_get, set, folders: WorkspaceFolder[]) => {
    set(workspaceFoldersAtom, folders);
    set(workspaceDirtyAtom, false);
    void autoSaveWorkspace(folders);
  }
);
setWorkspaceFoldersAtom.debugLabel = "setWorkspaceFoldersAtom";

/**
 * Set the primary folder by id.
 */
export const setPrimaryWorkspaceFolderAtom = atom(
  null,
  (get, set, folderId: string) => {
    const folders = get(workspaceFoldersAtom);
    const updated = folders.map((folder) => ({
      ...folder,
      isPrimary: folder.id === folderId,
    }));
    set(workspaceFoldersAtom, updated);
    set(workspaceDirtyAtom, true);
  }
);
setPrimaryWorkspaceFolderAtom.debugLabel = "setPrimaryWorkspaceFolderAtom";
