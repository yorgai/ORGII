/**
 * Git Blame API
 *
 * File blame/annotation functions.
 */
import { fetchRustApi, gitRepoUrl } from "./client";
import type { BlameResult } from "./types";

/**
 * Get blame information for a file
 * Uses Rust HTTP server with git2
 */
export const getGitBlame = async (params: {
  repo_id: string;
  file_path: string;
  ref?: string;
}): Promise<BlameResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.ref) queryParams.append("ref", params.ref);

  try {
    const response = await fetchRustApi<BlameResult>(
      `${gitRepoUrl(params.repo_id)}/blame/${encodeURIComponent(params.file_path)}${queryParams.toString() ? `?${queryParams.toString()}` : ""}`
    );
    return response.data;
  } catch (error) {
    console.error("[GitAPI] Failed to get blame:", error);
    return undefined;
  }
};
