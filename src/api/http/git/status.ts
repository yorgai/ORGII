/**
 * Git Status API
 *
 * Repository status and suggested action functions.
 */
import {
  cleanupCache,
  fetchRustApi,
  gitRepoUrl,
  statusRequestCache,
} from "./client";
import type { GitStatusData, GitSuggestedActionData } from "./types";

/**
 * Get comprehensive git repository status (with request deduplication)
 */
export const getGitStatus = async (params: {
  repo_id: string;
  repo_path?: string; // Optional: pass path as query param for efficiency
  include_untracked?: boolean;
}): Promise<GitStatusData | undefined> => {
  const cacheKey = `${params.repo_id}-${params.include_untracked ?? true}`;

  // Return existing promise if request is already in-flight
  if (statusRequestCache.has(cacheKey)) {
    return statusRequestCache.get(cacheKey) as Promise<
      GitStatusData | undefined
    >;
  }

  // Build query params
  const queryParams = new URLSearchParams({
    include_untracked: String(params.include_untracked ?? true),
  });

  // Add path as query param if provided (avoids UUID lookup overhead)
  if (params.repo_path) {
    queryParams.append("path", params.repo_path);
  }

  // Make new request to Rust HTTP server
  // repo_id in URL, path in query param
  const promise = fetchRustApi<GitStatusData>(
    `${gitRepoUrl(params.repo_id)}/status?${queryParams.toString()}`
  )
    .then((response) => response.data)
    .catch((error) => {
      console.error("[GitAPI] Failed to fetch status from Rust server:", error);
      return undefined;
    })
    .finally(() => cleanupCache(statusRequestCache, cacheKey));

  statusRequestCache.set(cacheKey, promise);
  return promise;
};

/**
 * Get suggested action based on repository state
 */
export const getGitSuggestedAction = async (params: {
  repo_id: string;
  repo_path?: string; // Optional: pass path as query param for efficiency
  is_github_repo?: boolean;
  has_open_pr?: boolean;
}): Promise<GitSuggestedActionData | undefined> => {
  // Build query params
  const queryParams = new URLSearchParams();

  // Add path as query param if provided (avoids UUID lookup overhead)
  if (params.repo_path) {
    queryParams.append("path", params.repo_path);
  }

  // Query params are computed by Rust based on git status, so we don't need to pass them
  const queryString = queryParams.toString();
  const endpoint = `${gitRepoUrl(params.repo_id)}/suggested-action${queryString ? "?" + queryString : ""}`;

  try {
    const response = await fetchRustApi<GitSuggestedActionData>(endpoint);
    return response.data;
  } catch (error) {
    console.error(
      "[GitAPI] Failed to fetch suggested action from Rust server:",
      error
    );
    return undefined;
  }
};
