/**
 * useWorkspaceSwitch
 *
 * Lightweight workspace switcher shared by the WorkspaceDropdown (compact anchored
 * picker) and any other surface that needs to list multi-repo workspace
 * presets and activate one. Distinct from `useWorkspacePaletteWorkspace`, which is
 * the Spotlight-only flow that also owns manage/edit/delete actions.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import {
  activeWorkspaceIdAtom,
  activeWorkspaceNameAtom,
  savedWorkspacesAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import type { WorkspaceFolder } from "@src/types/workspace";

import type { RepoItem } from "../../types";

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

function buildWorkspaceRepoNameResolver(repos: RepoItem[]) {
  const byId = new Map<string, string>(
    repos.map((repo) => [repo.id, String(repo.name ?? "")])
  );
  const byPath = new Map<string, string>(
    repos
      .map((repo): [string, string] => [
        normalizeFsPath(repo.fs_uri),
        String(repo.name ?? ""),
      ])
      .filter(([path]) => Boolean(path))
  );

  return (folder: WorkspaceRecord["folders"][number]): string => {
    if (folder.repoId) {
      const name = byId.get(folder.repoId);
      if (name) return name;
    }
    const name = byPath.get(normalizeFsPath(folder.folderPath));
    return name ?? folder.folderName;
  };
}

export interface UseWorkspaceSwitchOptions {
  /** Repo list used to resolve folder display names. */
  repos: RepoItem[];
  /** Called after activating a workspace, e.g. to close the picker. */
  onActivate?: () => void;
}

export interface WorkspaceSwitchEntry {
  workspace: WorkspaceRecord;
  isActive: boolean;
  /** Resolved folder display names, in folder order. */
  folderNames: string[];
}

export interface UseWorkspaceSwitchReturn {
  workspaces: WorkspaceSwitchEntry[];
  activeWorkspaceId: string | null;
  activateWorkspace: (workspace: WorkspaceRecord) => void;
}

export function useWorkspaceSwitch({
  repos,
  onActivate,
}: UseWorkspaceSwitchOptions): UseWorkspaceSwitchReturn {
  const savedWorkspaces = useAtomValue(savedWorkspacesAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);
  const setActiveWorkspaceName = useSetAtom(activeWorkspaceNameAtom);

  const resolveWorkspaceRepoName = useMemo(
    () => buildWorkspaceRepoNameResolver(repos),
    [repos]
  );

  const workspaces = useMemo<WorkspaceSwitchEntry[]>(() => {
    const ordered = [...savedWorkspaces].sort((workspaceA, workspaceB) => {
      if (workspaceA.workspaceId === activeWorkspaceId) return -1;
      if (workspaceB.workspaceId === activeWorkspaceId) return 1;
      return 0;
    });
    return ordered.map((workspace) => ({
      workspace,
      isActive: workspace.workspaceId === activeWorkspaceId,
      folderNames: workspace.folders.map(resolveWorkspaceRepoName),
    }));
  }, [savedWorkspaces, activeWorkspaceId, resolveWorkspaceRepoName]);

  const activateWorkspace = useCallback(
    (workspace: WorkspaceRecord) => {
      const folders: WorkspaceFolder[] = workspace.folders.map((folder) => ({
        id: crypto.randomUUID(),
        name: resolveWorkspaceRepoName(folder),
        path: folder.folderPath,
        uri: `file://${folder.folderPath}`,
        isPrimary: folder.isPrimary,
        repoId: folder.repoId ?? undefined,
        kind: folder.kind === "folder" ? ("folder" as const) : ("git" as const),
      }));
      dispatchSetFolders(folders, workspace.workspaceId);
      setActiveWorkspaceName(workspace.name);
      onActivate?.();
    },
    [
      dispatchSetFolders,
      resolveWorkspaceRepoName,
      setActiveWorkspaceName,
      onActivate,
    ]
  );

  return { workspaces, activeWorkspaceId, activateWorkspace };
}
