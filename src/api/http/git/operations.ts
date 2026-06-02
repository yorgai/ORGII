/**
 * Git Remote Operations API
 *
 * Fetch, pull, and push operations.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { GitOperationResponse, GitPullResponse } from "./types";

/**
 * Fetch updates from remote
 * Uses Rust HTTP server for better performance
 */
export const gitFetch = async (params: {
  repo_id: string;
  repo_path?: string;
  remote?: string;
  prune?: boolean;
  authUsername?: string;
  authToken?: string;
  storeAuth?: boolean;
}): Promise<GitOperationResponse["data"]> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  const response = await fetchRustApi<GitOperationResponse["data"]>(
    `${gitRepoUrl(params.repo_id)}/fetch${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({
        remote: params.remote ?? "origin",
        prune: params.prune ?? true,
        auth_username: params.authUsername ?? null,
        auth_token: params.authToken ?? null,
        store_auth: params.storeAuth ?? false,
      }),
    }
  );

  const result = response.data;

  // Check if fetch actually succeeded
  if (result && !result.success) {
    throw new Error(result.message || "Fetch failed");
  }

  return result;
};

/**
 * Pull updates from remote (fetch + merge/rebase)
 * Uses Rust HTTP server for better performance
 */
export const gitPull = async (params: {
  repo_id: string;
  repo_path?: string;
  remote?: string;
  branch?: string;
  strategy?: string;
  authUsername?: string;
  authToken?: string;
  storeAuth?: boolean;
}): Promise<GitPullResponse["data"]> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  const response = await fetchRustApi<GitPullResponse["data"]>(
    `${gitRepoUrl(params.repo_id)}/pull${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({
        remote: params.remote ?? "origin",
        branch: params.branch ?? null,
        strategy: params.strategy ?? null,
        auth_username: params.authUsername ?? null,
        auth_token: params.authToken ?? null,
        store_auth: params.storeAuth ?? false,
      }),
    }
  );

  const result = response.data;

  // Check if pull actually succeeded
  if (result && !result.success) {
    throw new Error(result.message || "Pull failed");
  }

  return result;
};

/**
 * Push commits to remote
 * Uses Rust HTTP server for better performance
 */
export const gitPush = async (params: {
  repo_id: string;
  repo_path?: string;
  remote?: string;
  branch?: string;
  set_upstream?: boolean;
  force?: boolean;
  authUsername?: string;
  authToken?: string;
  storeAuth?: boolean;
}): Promise<GitOperationResponse["data"]> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  const response = await fetchRustApi<GitOperationResponse["data"]>(
    `${gitRepoUrl(params.repo_id)}/push${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({
        remote: params.remote ?? "origin",
        branch: params.branch ?? null,
        set_upstream: params.set_upstream ?? false,
        force: params.force ?? false,
        auth_username: params.authUsername ?? null,
        auth_token: params.authToken ?? null,
        store_auth: params.storeAuth ?? false,
      }),
    }
  );

  const result = response.data;

  // Check if push actually succeeded
  if (result && !result.success) {
    throw new Error(result.message || "Push failed");
  }

  return result;
};
