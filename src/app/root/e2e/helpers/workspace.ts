import { invoke } from "@tauri-apps/api/core";

import { reposAtom, selectedRepoIdAtom } from "@src/store/repo/atoms";
import { REPO_KIND, type Repo } from "@src/store/repo/types";
import {
  activeFolderIdAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceNameAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import { asError } from "../result";
import type {
  E2EStore,
  EnsureRepoSelectedOptions,
  Json,
  Result,
  SeedMultiRootWorkspaceOptions,
} from "../types";
import { e2eUrl } from "./e2eBaseUrl";

export function createWorkspaceHelpers(store: E2EStore) {
  const getOrgiiRoot = async (): Promise<Result<{ path: string }>> => {
    try {
      const memPath = (await invoke("get_memory_storage_path")) as string;
      const path = memPath.replace(/[/\\]sessions\.db$/, "");
      return { ok: true, path };
    } catch (err) {
      return asError(err);
    }
  };

  const ensureRepoSelected = async (
    opts?: EnsureRepoSelectedOptions
  ): Promise<Result<{ repoId: string; path: string }>> => {
    try {
      const pinRepoPath = (
        repoPath: string
      ): { repoId: string; path: string } => {
        const repoId = `e2e-repo-${btoa(repoPath)
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 24)}`;
        const repo: Repo = {
          id: repoId,
          name:
            opts?.repoName ??
            repoPath.split(/[\\/]/).filter(Boolean).pop() ??
            "E2E Repo",
          path: repoPath,
          fs_uri: repoPath,
          kind: REPO_KIND.GIT,
        };
        const existingRepos = store.get(reposAtom);
        store.set(reposAtom, [
          repo,
          ...existingRepos.filter((existingRepo) => existingRepo.id !== repoId),
        ]);
        store.set(selectedRepoIdAtom, repoId);
        return { repoId, path: repoPath };
      };

      if (opts?.repoPath) {
        return { ok: true, ...pinRepoPath(opts.repoPath) };
      }

      const deadline = Date.now() + 15_000;
      let repos = store.get(reposAtom);
      while (repos.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        repos = store.get(reposAtom);
      }
      const currentSelected = store.get(selectedRepoIdAtom);
      const selectedRepo =
        repos.find((repo) => repo.id === currentSelected) ?? repos[0];
      if (selectedRepo?.id && selectedRepo.path) {
        if (selectedRepo.id !== currentSelected) {
          store.set(selectedRepoIdAtom, selectedRepo.id);
        }
        return { ok: true, repoId: selectedRepo.id, path: selectedRepo.path };
      }

      return {
        ok: false,
        error: "ensureRepoSelected: no repo path available",
      };
    } catch (err) {
      return asError(err);
    }
  };

  const getSelectedRepoPath = async (): Promise<Result<{ path: string }>> => {
    const selected = await ensureRepoSelected();
    if (!selected.ok) return selected;
    return { ok: true, path: selected.path };
  };

  const seedMultiRootWorkspace = async (
    opts: SeedMultiRootWorkspaceOptions
  ): Promise<
    Result<{
      workspaceId: string;
      primaryPath: string;
      additionalDirectories: string[];
    }>
  > => {
    try {
      if (!Array.isArray(opts.folders) || opts.folders.length < 2) {
        return {
          ok: false,
          error: "seedMultiRootWorkspace: at least two folders are required",
        };
      }
      const normalizedFolders = opts.folders.map((folder, index) => {
        const path = folder.path.replace(/\/+$/, "");
        return {
          id: folder.id ?? `e2e-workspace-folder-${index}`,
          name: folder.name,
          path,
          uri: `file://${path}`,
          isPrimary: folder.isPrimary ?? index === 0,
          repoId: folder.id ?? `e2e-workspace-folder-${index}`,
          kind: REPO_KIND.GIT,
        };
      });
      const primary =
        normalizedFolders.find((folder) => folder.isPrimary) ??
        normalizedFolders[0];
      const repos: Repo[] = normalizedFolders.map((folder) => ({
        id: folder.repoId,
        name: folder.name,
        path: folder.path,
        fs_uri: folder.path,
        kind: REPO_KIND.GIT,
      }));
      const workspaceId = opts.workspaceId ?? "e2e-multi-root-workspace";
      store.set(workspaceFoldersAtom, normalizedFolders);
      store.set(activeWorkspaceIdAtom, workspaceId);
      store.set(activeWorkspaceNameAtom, opts.workspaceName ?? null);
      store.set(activeFolderIdAtom, primary.id);
      store.set(reposAtom, repos);
      store.set(selectedRepoIdAtom, primary.repoId);
      return {
        ok: true,
        workspaceId,
        primaryPath: primary.path,
        additionalDirectories: normalizedFolders
          .filter((folder) => folder.path !== primary.path)
          .map((folder) => folder.path),
      };
    } catch (err) {
      return asError(err);
    }
  };

  const readSessionWorkspaceFromDb = async (
    sessionId: string
  ): Promise<Result<{ result: Json }>> => {
    try {
      const response = await fetch(
        e2eUrl("/agent/test/session/workspace/list-from-db"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        }
      );
      const result = (await response.json()) as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    getOrgiiRoot,
    getSelectedRepoPath,
    ensureRepoSelected,
    seedMultiRootWorkspace,
    readSessionWorkspaceFromDb,
  };
}
