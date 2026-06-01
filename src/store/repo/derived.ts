/**
 * Repo Store Derived Atoms
 *
 * Computed/derived atoms that depend on core atoms.
 */
import { atom } from "jotai";

import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { activeFolderAtom } from "@src/store/workspace/derived";

import {
  branchesAtom,
  cachedReposAtom,
  repoFilterAtom,
  repoLastCheckAtom,
  reposAtom,
  selectedRepoIdAtom,
  validRepoIdsAtom,
} from "./atoms";
import { REPO_KIND, type Repo } from "./types";

// ============================================
// Repo Lookups
// ============================================

/** Map for O(1) repo lookups by ID */
export const repoMapAtom = atom<Map<string, Repo>>((get) => {
  const repos = get(reposAtom);
  return new Map(repos.map((repo) => [repo.id, repo]));
});
repoMapAtom.debugLabel = "repoMapAtom";

/**
 * Get current repo by selected ID (now O(1) instead of O(n))
 * Falls back to cached repo data if main repos haven't loaded yet.
 *
 * Multi-root behavior: when the workspace has 2+ folders, the active folder
 * (derived from the focused editor, explicit user override, or the primary)
 * is projected onto its corresponding repo. This keeps status bar / toolbar
 * pill / git panels following the user's focus instead of the static
 * selectedRepoIdAtom.
 */
export const currentRepoAtom = atom<Repo | undefined>((get) => {
  const repoMap = get(repoMapAtom);
  const folders = get(workspaceFoldersAtom);

  if (folders.length > 1) {
    const active = get(activeFolderAtom);
    if (active) {
      // Prefer the explicit Repo link stored on the folder
      if (active.repoId) {
        const linked = repoMap.get(active.repoId);
        if (linked) return linked;
      }
      // Fall back to matching by path (handles folders that haven't been
      // imported yet or whose repoId is stale)
      const normalized = active.path.replace(/\/+$/, "");
      for (const repo of repoMap.values()) {
        const repoPath = (repo.path ?? repo.fs_uri ?? "").replace(/\/+$/, "");
        if (repoPath === normalized) return repo;
      }
      // Synthesize a minimal Repo so downstream consumers still get a path
      // (e.g. non-git workspace folder added via "Add Folder to Workspace").
      return {
        id: active.repoId ?? active.id,
        name: active.name,
        path: active.path,
        fs_uri: active.path,
        kind: active.kind === "folder" ? REPO_KIND.FOLDER : REPO_KIND.GIT,
      } as Repo;
    }
  }

  const selectedId = get(selectedRepoIdAtom);

  // First try the main repo map
  const mainRepo = repoMap.get(selectedId);
  if (mainRepo) return mainRepo;

  // Fall back to cached repos (for hot reload / quick restore)
  const cachedRepos = get(cachedReposAtom);
  const cachedRepo = cachedRepos.find((repo) => repo.id === selectedId);
  if (cachedRepo) {
    // Convert CachedRepo to Repo format
    return {
      id: cachedRepo.id,
      name: cachedRepo.name,
      path: cachedRepo.path,
      fs_uri: cachedRepo.path,
      repo_url: cachedRepo.repo_url,
    } as Repo;
  }

  return undefined;
});
currentRepoAtom.debugLabel = "currentRepoAtom";

/** Check if a repo ID is valid */
export const isValidRepoIdAtom = atom((get) => {
  const validIds = get(validRepoIdsAtom);
  return (id: string) => validIds.has(id);
});
isValidRepoIdAtom.debugLabel = "isValidRepoIdAtom";

// ============================================
// Filtered & Search
// ============================================

/** Filtered repos by search term */
export const filteredReposAtom = atom((get) => {
  const repos = get(reposAtom);
  const filter = get(repoFilterAtom);
  if (!filter) return repos;
  return repos.filter((repo) =>
    repo.name.toLowerCase().includes(filter.toLowerCase())
  );
});
filteredReposAtom.debugLabel = "filteredReposAtom";

/** Branch options for dropdowns */
export const branchOptionsAtom = atom((get) => {
  const branches = get(branchesAtom);
  return branches.map((branch) => ({
    label: branch.name,
    value: branch.name,
    subLabel: branch.lastCommitDate,
  }));
});
branchOptionsAtom.debugLabel = "branchOptionsAtom";

// ============================================
// Stats Atoms
// ============================================

/** Total number of repos */
export const repoCountAtom = atom((get) => {
  return get(reposAtom).length;
});
repoCountAtom.debugLabel = "repoCountAtom";

/** Check if there are any repos */
export const hasReposAtom = atom((get) => {
  return get(reposAtom).length > 0;
});
hasReposAtom.debugLabel = "hasReposAtom";

/** Check if selected repo is valid */
export const isSelectedRepoValidAtom = atom((get) => {
  const selectedId = get(selectedRepoIdAtom);
  const validIds = get(validRepoIdsAtom);
  return selectedId ? validIds.has(selectedId) : false;
});
isSelectedRepoValidAtom.debugLabel = "isSelectedRepoValidAtom";

/** Repos grouped by type (local vs remote) */
export const reposByTypeAtom = atom((get) => {
  const repos = get(reposAtom);
  return {
    local: repos.filter((repo) => !repo.repo_url),
    remote: repos.filter((repo) => !!repo.repo_url),
  };
});
reposByTypeAtom.debugLabel = "reposByTypeAtom";

// ============================================
// Kind-based Filtering (git repos vs work folders)
// ============================================

/** Only git repositories */
export const gitReposAtom = atom((get) => {
  return get(reposAtom).filter((repo) => repo.kind !== REPO_KIND.FOLDER);
});
gitReposAtom.debugLabel = "gitReposAtom";

/** Only work folders */
export const workFoldersAtom = atom((get) => {
  return get(reposAtom).filter((repo) => repo.kind === REPO_KIND.FOLDER);
});
workFoldersAtom.debugLabel = "workFoldersAtom";

/** Whether the currently selected repo is a git repository (not a work folder) */
export const currentRepoIsGitAtom = atom((get) => {
  const repo = get(currentRepoAtom);
  return repo?.kind !== REPO_KIND.FOLDER;
});
currentRepoIsGitAtom.debugLabel = "currentRepoIsGitAtom";

/** Total stats across all repos */
export const repoTotalStatsAtom = atom((get) => {
  const repos = get(reposAtom);
  return repos.reduce(
    (acc, repo) => ({
      sessions: acc.sessions + (repo.stats?.sessions || 0),
      linkedProjects: acc.linkedProjects + (repo.stats?.linked_stories || 0),
      workItems: acc.workItems + (repo.stats?.work_items || 0),
      contextItems: acc.contextItems + (repo.stats?.context_items || 0),
    }),
    { sessions: 0, linkedProjects: 0, workItems: 0, contextItems: 0 }
  );
});
repoTotalStatsAtom.debugLabel = "repoTotalStatsAtom";

/** Computed: How long ago repos were loaded (in seconds) */
export const repoAgeSecondsAtom = atom<number | null>((get) => {
  const lastCheck = get(repoLastCheckAtom);
  if (!lastCheck) return null;
  return Math.floor((Date.now() - lastCheck.getTime()) / 1000);
});
repoAgeSecondsAtom.debugLabel = "repoAgeSecondsAtom";
