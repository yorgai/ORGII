/**
 * Git Staging API
 *
 * File staging, unstaging, and discard functions.
 */
import { fetchRustApi, gitRepoUrl } from "./client";

/**
 * Stage files for commit
 * Uses Rust HTTP server
 */
export const gitStageFiles = async (params: {
  repo_id: string;
  repo_path?: string;
  files: string[];
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/stage${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({ files: params.files }),
      }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to stage files:", error);
    return false;
  }
};

/**
 * Unstage files
 * Uses Rust HTTP server
 */
export const gitUnstageFiles = async (params: {
  repo_id: string;
  repo_path?: string;
  files: string[];
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/unstage${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({ files: params.files }),
      }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to unstage files:", error);
    return false;
  }
};

/**
 * Discard file changes
 * Uses Rust HTTP server
 */
export const gitDiscardChanges = async (params: {
  repo_id: string;
  repo_path?: string;
  files: string[];
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/discard${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({ files: params.files }),
      }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to discard changes:", error);
    return false;
  }
};

/**
 * Resolve a merge conflict file using a strategy
 * Uses Rust HTTP server
 */
export const gitResolveConflict = async (params: {
  repo_id: string;
  repo_path?: string;
  file: string;
  strategy: "ours" | "theirs";
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/resolve-conflict${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          file: params.file,
          strategy: params.strategy,
        }),
      }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to resolve conflict:", error);
    return false;
  }
};
