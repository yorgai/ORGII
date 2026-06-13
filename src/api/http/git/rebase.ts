/**
 * Git Rebase API
 *
 * Rebase operations and conflict resolution.
 */
import { createLogger } from "@src/hooks/logger";

import { fetchRustApi, gitRepoUrl } from "./client";
import type { RebaseResult } from "./types";

const log = createLogger("GitAPI");

/**
 * Rebase current branch onto another branch
 * Uses Rust HTTP server
 */
export const gitRebase = async (params: {
  repo_id: string;
  repo_path?: string;
  upstream: string;
  branch?: string | null;
}): Promise<RebaseResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<RebaseResult>(
      `${gitRepoUrl(params.repo_id)}/rebase${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          upstream: params.upstream,
          branch: params.branch ?? null,
        }),
      }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to rebase:", error);
    return undefined;
  }
};

/**
 * Continue rebase after resolving conflicts
 * Uses Rust HTTP server
 */
export const gitRebaseContinue = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<RebaseResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<RebaseResult>(
      `${gitRepoUrl(params.repo_id)}/rebase/continue${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to continue rebase:", error);
    return undefined;
  }
};

/**
 * Abort an ongoing rebase
 * Uses Rust HTTP server
 */
export const gitRebaseAbort = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/rebase/abort${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return true;
  } catch (error) {
    log.error("[GitAPI] Failed to abort rebase:", error);
    return false;
  }
};

/**
 * Skip the current commit during rebase
 * Uses Rust HTTP server
 */
export const gitRebaseSkip = async (params: {
  repo_id: string;
  repo_path?: string;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/rebase/skip${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "POST" }
    );
    return true;
  } catch (error) {
    log.error("[GitAPI] Failed to skip rebase commit:", error);
    return false;
  }
};
