/**
 * Workspace Derived Atoms
 *
 * Derived atoms that compose the multi-root workspace model with
 * editor state and the repo store. These are the canonical targets
 * for UI surfaces (status bar, toolbar pill, panel titles) and for
 * features that need to know "which folder does the user currently
 * care about" when multi-root.
 *
 * Resolution priority for activeFolderAtom:
 *   1. Explicit user override via activeFolderIdAtom
 *   2. Folder owning the currently focused editor file
 *   3. Primary folder (isPrimary)
 *   4. First folder in the list
 */
import { atom } from "jotai";

import { reposAtom } from "@src/store/repo/atoms";
import { fileSelectedPathAtom } from "@src/store/workstation/codeEditor/file";
import type { WorkspaceFolder } from "@src/types/workspace";

import {
  activeFolderIdAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceNameAtom,
  savedWorkspacesAtom,
  workspaceConfigPathAtom,
  workspaceFoldersAtom,
} from "../ui/workspaceFoldersAtom";

/**
 * Primary folder — the one agents/LSP/search default to in multi-root mode.
 * Falls back to the first folder if none is marked primary.
 */
export const primaryFolderAtom = atom<WorkspaceFolder | null>((get) => {
  const folders = get(workspaceFoldersAtom);
  if (folders.length === 0) return null;
  return folders.find((folder) => folder.isPrimary) ?? folders[0];
});
primaryFolderAtom.debugLabel = "primaryFolderAtom";

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

function findOwningFolder(
  folders: WorkspaceFolder[],
  filePath: string | null
): WorkspaceFolder | null {
  if (!filePath || folders.length === 0) return null;
  const normalized = filePath.replace(/\/+$/, "");
  // Sort by path length descending so the most-specific root wins
  // (handles nested roots, e.g. /a/b and /a/b/c).
  const sorted = [...folders].sort((a, b) => b.path.length - a.path.length);
  for (const folder of sorted) {
    const folderPath = folder.path.replace(/\/+$/, "");
    if (normalized === folderPath || normalized.startsWith(`${folderPath}/`)) {
      return folder;
    }
  }
  return null;
}

/**
 * The folder the user currently cares about. Used by status bar,
 * toolbar pill, and per-folder feature defaults.
 */
export const activeFolderAtom = atom<WorkspaceFolder | null>((get) => {
  const folders = get(workspaceFoldersAtom);
  if (folders.length === 0) return null;

  const overrideId = get(activeFolderIdAtom);
  if (overrideId) {
    const override = folders.find((folder) => folder.id === overrideId);
    if (override) return override;
  }

  const editorPath = get(fileSelectedPathAtom);
  const owning = findOwningFolder(folders, editorPath);
  if (owning) return owning;

  return get(primaryFolderAtom);
});
activeFolderAtom.debugLabel = "activeFolderAtom";

/**
 * Display name for the current workspace.
 * - If a .orgii-workspace file is loaded: uses its filename (without extension)
 * - If a DB workspace is active: uses its saved name (e.g. "ORGII Repos")
 * - If multi-root without a saved name: "{primaryRepoName} Workspace"
 * - If single-root: the folder's name
 */
export const workspaceNameAtom = atom<string>((get) => {
  const configPath = get(workspaceConfigPathAtom);
  if (configPath) {
    const filename = configPath.split("/").pop() ?? configPath;
    return filename.replace(/\.orgii-workspace$/, "");
  }

  const activeWorkspaceId = get(activeWorkspaceIdAtom);
  if (activeWorkspaceId) {
    const savedWorkspace = get(savedWorkspacesAtom).find(
      (workspace) => workspace.workspaceId === activeWorkspaceId
    );
    if (savedWorkspace) return savedWorkspace.name;
  }

  const dbName = get(activeWorkspaceNameAtom);
  if (dbName) return dbName;

  const folders = get(workspaceFoldersAtom);
  if (folders.length === 0) return "";
  if (folders.length === 1) return folders[0].name;

  const primary = get(primaryFolderAtom) ?? folders[0];
  const repos = get(reposAtom);
  const repoName = primary.repoId
    ? repos.find((repo) => repo.id === primary.repoId)?.name
    : repos.find(
        (repo) =>
          normalizeFsPath(repo.fs_uri ?? repo.path) ===
          normalizeFsPath(primary.path)
      )?.name;

  return `${repoName ?? primary.name} Workspace`;
});
workspaceNameAtom.debugLabel = "workspaceNameAtom";

/**
 * Number of folders currently in the workspace (for UI badges like "(3)").
 */
export const workspaceFolderCountAtom = atom<number>((get) => {
  return get(workspaceFoldersAtom).length;
});
workspaceFolderCountAtom.debugLabel = "workspaceFolderCountAtom";
