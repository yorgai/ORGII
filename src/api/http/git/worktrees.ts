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
