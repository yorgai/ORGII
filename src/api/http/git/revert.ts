/**
 * Git Revert API
 *
 * Commit revert operations.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { RevertResult } from "./types";

/**
 * Revert a commit
 * Uses Rust HTTP server
 */
export const gitRevert = async (params: {
  repo_id: string;
  repo_path?: string;
  commit: string;
  no_commit?: boolean;
}): Promise<RevertResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<RevertResult>(
      `${gitRepoUrl(params.repo_id)}/revert${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          commit: params.commit,
          no_commit: params.no_commit ?? false,
        }),
      }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to revert:", error);
    return undefined;
  }
};

/**
 * Abort an ongoing revert
 * Uses Rust HTTP server
 */
export const gitRevertAbort = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/revert/abort${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to abort revert:", error);
    return false;
  }
};
