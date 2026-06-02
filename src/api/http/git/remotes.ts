/**
 * Git Remotes API
 *
 * Remote repository management functions.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type {
  GitCredentialFillResponse,
  GitRemoteInfo,
  GitRemotesResponse,
} from "./types";

/**
 * Get all configured remotes
 * Uses Rust HTTP server for better performance
 */
export const getGitRemotes = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<GitRemotesResponse["data"] | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<GitRemotesResponse["data"]>(
      `${gitRepoUrl(params.repo_id)}/remotes${queryParams.toString() ? `?${queryParams.toString()}` : ""}`
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to fetch remotes from Rust server:", error);
    return undefined;
  }
};

export const fillGitCredentials = async (params: {
  repo_id: string;
  repo_path?: string;
  remoteUrl: string;
}): Promise<GitCredentialFillResponse["data"] | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  const response = await fetchRustApi<GitCredentialFillResponse["data"]>(
    `${gitRepoUrl(params.repo_id)}/credentials/fill${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({ remote_url: params.remoteUrl }),
    }
  );
  return response.data;
};

/**
 * Add a new remote
 * Uses Rust HTTP server
 */
export const addGitRemote = async (params: {
  repo_id: string;
  repo_path?: string;
  name: string;
  url: string;
}): Promise<GitRemoteInfo | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<GitRemoteInfo>(
      `${gitRepoUrl(params.repo_id)}/remotes${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: params.name,
          url: params.url,
        }),
      }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to add remote:", error);
    return undefined;
  }
};

/**
 * Update remote URL
 * Uses Rust HTTP server
 */
export const updateGitRemote = async (params: {
  repo_id: string;
  repo_path?: string;
  remote_name: string;
  url: string;
}): Promise<GitRemoteInfo | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<GitRemoteInfo>(
      `${gitRepoUrl(params.repo_id)}/remotes/${encodeURIComponent(params.remote_name)}${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "PUT",
        body: JSON.stringify({ url: params.url }),
      }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to update remote:", error);
    return undefined;
  }
};

/**
 * Delete a remote
 * Uses Rust HTTP server
 */
export const deleteGitRemote = async (params: {
  repo_id: string;
  repo_path?: string;
  remote_name: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/remotes/${encodeURIComponent(params.remote_name)}${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "DELETE" }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to delete remote:", error);
    return false;
  }
};
