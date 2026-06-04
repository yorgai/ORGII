/**
 * Git Worktree API
 *
 * List all git worktrees for a repository.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { GitWorktreeEntry } from "./types";

export async function getGitWorktrees(params: {
  repo_id: string;
  repo_path?: string;
}): Promise<GitWorktreeEntry[]> {
  const queryParams = new URLSearchParams();
  if (params.repo_path) {
    queryParams.append("path", params.repo_path);
  }

  const queryString = queryParams.toString();
  const endpoint = `${gitRepoUrl(params.repo_id)}/worktrees${queryString ? "?" + queryString : ""}`;

  const response = await fetchRustApi<GitWorktreeEntry[]>(endpoint);
  return response.data;
}

export async function removeGitWorktree(params: {
  repo_id: string;
  repo_path?: string;
  worktree_path: string;
  force?: boolean;
}): Promise<GitWorktreeEntry> {
  const queryParams = new URLSearchParams();
  if (params.repo_path) {
    queryParams.append("path", params.repo_path);
  }

  const queryString = queryParams.toString();
  const endpoint = `${gitRepoUrl(params.repo_id)}/worktrees${queryString ? "?" + queryString : ""}`;

  const response = await fetchRustApi<GitWorktreeEntry>(endpoint, {
    method: "DELETE",
    body: JSON.stringify({
      worktree_path: params.worktree_path,
      force: params.force ?? true,
    }),
  });
  return response.data;
}
