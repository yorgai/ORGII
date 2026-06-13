/**
 * Git Stash API
 *
 * Stash management functions.
 */
import { createLogger } from "@src/hooks/logger";

import { fetchRustApi, gitRepoUrl } from "./client";
import type { StashList, StashResult } from "./types";

const log = createLogger("GitAPI");

/**
 * Create a stash - save working directory changes
 * Uses Rust HTTP server
 */
export const gitStashPush = async (params: {
  repo_id: string;
  repo_path?: string;
  files?: string[] | null;
  message?: string | null;
  include_untracked?: boolean;
}): Promise<StashResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<StashResult>(
      `${gitRepoUrl(params.repo_id)}/stash${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          files: params.files ?? null,
          message: params.message ?? null,
          include_untracked: params.include_untracked ?? false,
        }),
      }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to stash push:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to stash changes";
    return {
      success: false,
      message: errorMessage,
      stash_ref: null,
    };
  }
};

/**
 * List all stashes
 * Uses Rust HTTP server
 */
export const gitStashList = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<StashList | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<StashList>(
      `${gitRepoUrl(params.repo_id)}/stash${queryParams.toString() ? `?${queryParams.toString()}` : ""}`
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to list stashes:", error);
    return undefined;
  }
};

/**
 * Apply a stash
 * Uses Rust HTTP server
 */
export const gitStashApply = async (params: {
  repo_id: string;
  repo_path?: string;
  index?: number;
  pop?: boolean;
}): Promise<StashResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<StashResult>(
      `${gitRepoUrl(params.repo_id)}/stash/apply${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          index: params.index ?? 0,
          pop: params.pop ?? false,
        }),
      }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to apply stash:", error);
    // Return error result instead of undefined so caller can show specific error
    const errorMessage =
      error instanceof Error ? error.message : "Failed to apply stash";
    return {
      success: false,
      message: errorMessage,
      stash_ref: null,
    };
  }
};

/**
 * Drop a stash
 * Uses Rust HTTP server
 */
export const gitStashDrop = async (params: {
  repo_id: string;
  repo_path?: string;
  index: number;
}): Promise<StashResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<StashResult>(
      `${gitRepoUrl(params.repo_id)}/stash/${params.index}${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "DELETE" }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to drop stash:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to drop stash";
    return {
      success: false,
      message: errorMessage,
      stash_ref: null,
    };
  }
};
