/**
 * Git Commits API
 *
 * Commit listing and creation functions.
 */
import { createLogger } from "@src/hooks/logger";
import { shouldIncludeGitCoauthor } from "@src/services/git/operations/commitAttribution";

import { fetchRustApi, gitRepoUrl } from "./client";
import type {
  GitCommitResponse,
  GitCommitResultFull,
  GitCommitsResponse,
} from "./types";

const log = createLogger("GitAPI");

/**
 * Get commit history with pagination
 * Uses Rust HTTP server for better performance
 */
export const getGitCommits = async (params: {
  repo_id: string;
  repo_path?: string;
  file_path?: string; // File path to filter commits (relative to repo root)
  revision_range?: string;
  limit?: number;
  skip?: number;
}): Promise<GitCommitsResponse["data"] | undefined> => {
  const queryParams = new URLSearchParams();

  // Add repo path as query param (helps backend locate the repository)
  // Prefer repo_path (filesystem path) over repo_id (may be UUID)
  const pathForQuery = params.repo_path || params.repo_id;
  if (pathForQuery) {
    queryParams.append("path", pathForQuery);
  }

  // Add file path filter if provided (filter commits that touched this file)
  if (params.file_path) {
    queryParams.append("file_path", params.file_path);
  }

  if (params.limit) {
    queryParams.append("limit", String(params.limit));
  }

  if (params.skip) {
    queryParams.append("skip", String(params.skip));
  }

  const url = `${gitRepoUrl(params.repo_id)}/commits?${queryParams.toString()}`;

  try {
    const response = await fetchRustApi<GitCommitsResponse["data"]>(url);
    return response.data;
  } catch (_error) {
    return undefined;
  }
};

/**
 * Get local (unpushed) commits
 * Uses Rust HTTP server
 */
export const getGitLocalCommits = async (params: {
  repo_id: string;
  repo_path?: string;
  branch?: string;
}): Promise<GitCommitsResponse["data"] | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);
  if (params.branch) queryParams.append("branch", params.branch);

  try {
    const response = await fetchRustApi<GitCommitsResponse["data"]>(
      `${gitRepoUrl(params.repo_id)}/local-commits${queryParams.toString() ? `?${queryParams.toString()}` : ""}`
    );
    return response.data;
  } catch (error) {
    log.error(
      "[GitAPI] Failed to fetch local commits from Rust server:",
      error
    );
    return undefined;
  }
};

/**
 * Stage and commit changes
 * Uses Rust HTTP server
 */
export const gitCommit = async (params: {
  repo_id: string;
  repo_path?: string;
  message: string;
  description?: string;
  stage_all?: boolean;
  files?: string[];
  coauthor?: boolean;
}): Promise<GitCommitResponse["data"]> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  const response = await fetchRustApi<GitCommitResponse["data"]>(
    `${gitRepoUrl(params.repo_id)}/commit${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({
        message: params.message,
        description: params.description ?? null,
        stage_all: params.stage_all ?? false,
        files: params.files ?? null,
        coauthor: params.coauthor ?? shouldIncludeGitCoauthor(),
      }),
    }
  );

  // Response.data contains the commit SHA if successful
  // Rust backend returns error response if commit fails
  return response.data;
};

/**
 * Amend the last commit
 * Uses Rust HTTP server
 */
export const gitAmendCommit = async (params: {
  repo_id: string;
  repo_path?: string;
  message?: string | null;
  files?: string[] | null;
}): Promise<GitCommitResultFull | undefined> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    const response = await fetchRustApi<GitCommitResultFull>(
      `${gitRepoUrl(params.repo_id)}/commit/amend${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          message: params.message ?? null,
          files: params.files ?? null,
        }),
      }
    );
    return response.data;
  } catch (error) {
    log.error("[GitAPI] Failed to amend commit:", error);
    return undefined;
  }
};
