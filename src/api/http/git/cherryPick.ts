/**
 * Git Cherry-pick API
 *
 * Cherry-pick operations and conflict resolution.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { CherryPickResult } from "./types";

/**
 * Cherry-pick a commit
 * Uses Rust HTTP server
 */
export const gitCherryPick = async (params: {
  repo_id: string;
  repo_path?: string;
  commit: string;
  no_commit?: boolean;
}): Promise<CherryPickResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<CherryPickResult>(
      `${gitRepoUrl(params.repo_id)}/cherry-pick${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
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
    console.error("[GitAPI] Failed to cherry-pick:", error);
    return undefined;
  }
};

/**
 * Continue cherry-pick after resolving conflicts
 * Uses Rust HTTP server
 */
export const gitCherryPickContinue = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<CherryPickResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<CherryPickResult>(
      `${gitRepoUrl(params.repo_id)}/cherry-pick/continue${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to continue cherry-pick:", error);
    return undefined;
  }
};

/**
 * Abort an ongoing cherry-pick
 * Uses Rust HTTP server
 */
export const gitCherryPickAbort = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/cherry-pick/abort${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to abort cherry-pick:", error);
    return false;
  }
};
