/**
 * Git Reset API
 *
 * HEAD reset operations.
 */
import { createLogger } from "@src/hooks/logger";

import { fetchRustApi, gitRepoUrl } from "./client";
import type { ResetMode, ResetResult } from "./types";

const log = createLogger("GitAPI");

/**
 * Reset HEAD to a specific ref
 * Uses Rust HTTP server
 */
export const gitReset = async (params: {
  repo_id: string;
  repo_path?: string;
  ref?: string;
  mode?: ResetMode;
}): Promise<ResetResult | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<ResetResult>(
      `${gitRepoUrl(params.repo_id)}/reset${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: params.ref ?? "HEAD",
          mode: params.mode ?? "mixed",
        }),
      }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to reset:", error);
    return undefined;
  }
};
