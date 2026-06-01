/**
 * Git Merge API
 *
 * Merge operations and conflict resolution.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { MergeResult } from "./types";

/**
 * Merge a branch into current branch
 * Uses Rust HTTP server
 */
export const gitMerge = async (params: {
  repo_id: string;
  repo_path?: string;
  branch: string;
  no_ff?: boolean;
  message?: string | null;
}): Promise<MergeResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<MergeResult>(
      `${gitRepoUrl(params.repo_id)}/merge${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          branch: params.branch,
          no_ff: params.no_ff ?? false,
          message: params.message ?? null,
        }),
      }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to merge:", error);
    return undefined;
  }
};

/**
 * Abort an ongoing merge
 * Uses Rust HTTP server
 */
export const gitMergeAbort = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/merge/abort${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to abort merge:", error);
    return false;
  }
};

/**
 * Continue merge after resolving conflicts
 * Uses Rust HTTP server
 */
export const gitMergeContinue = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<MergeResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<MergeResult>(
      `${gitRepoUrl(params.repo_id)}/merge/continue${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to continue merge:", error);
    return undefined;
  }
};
