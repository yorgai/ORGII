/**
 * GitHub Local API
 *
 * Calls GitHub API directly from Tauri Rust instead of going through
 * the hosted backend (port 8001). Reduces server pressure by
 * running repos, branches, clone, PR, and profile fetching locally.
 */
import { invoke } from "@tauri-apps/api/core";

import { API_BASE_URLS } from "../../http/client/config";

export const LOCAL_GITHUB_TOKEN_USER_ID = "local_git";

// ============================================
// Helpers
// ============================================

interface GitHubInvokeParams {
  userId: string;
  hostedServiceUrl: string;
  hostedToken: string;
}

function baseParams(userId: string, token: string): GitHubInvokeParams {
  return {
    userId,
    hostedServiceUrl: API_BASE_URLS.hostedService,
    hostedToken: token,
  };
}

/**
 * Wraps a GitHub invoke call with re-auth error detection.
 * Throws a typed error when the user needs to re-authorize.
 */
export class GitHubReAuthError extends Error {
  constructor() {
    super("GitHub re-authorization required");
    this.name = "GitHubReAuthError";
  }
}

async function invokeWithAuth<T>(
  command: string,
  args: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("GitHubReAuthRequired")) {
      throw new GitHubReAuthError();
    }
    throw err;
  }
}

// ============================================
// Types (matching Rust-side structs)
// ============================================

export interface LocalGitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
}

export interface LocalGitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface LocalPRResponse {
  number: number;
  url: string;
}

export interface GitHubGitCredential {
  username: string;
  token: string;
  repo_full_name: string;
}

export interface ProfileData {
  user: Record<string, unknown>;
  repos: Record<string, unknown>[];
  languages: { language: string; bytes: number; percentage: number }[];
  commit_history: { year: number; total_commits: number }[];
  top_repos: Record<string, unknown>[];
}

export interface GhCliCredential {
  username: string;
  token: string;
}

export interface SshKeyInfo {
  filename: string;
  key_type: string;
  comment: string;
}

export interface CredentialHelperInfo {
  helper: string;
  username: string | null;
  token: string | null;
}

export interface DetectedGitHubCredentials {
  gh_cli: GhCliCredential | null;
  ssh_keys: SshKeyInfo[];
  credential_helper: CredentialHelperInfo | null;
  git_credentials_has_github: boolean;
}

export interface StoreTokenResult {
  username: string;
}

// ============================================
// API Functions
// ============================================

/**
 * Exchange a one-time ticket for a GitHub token and store it in keychain.
 * Called after OAuth redirect with `?token_ticket=xxx`.
 */
export async function storeGitHubToken(
  userId: string,
  ticket: string,
  token: string
): Promise<void> {
  await invoke("github_store_token", {
    userId,
    ticket,
    hostedServiceUrl: API_BASE_URLS.hostedService,
    hostedToken: token,
  });
}

/**
 * List the authenticated user's repositories.
 */
export async function listReposLocal(
  userId: string,
  token: string,
  page?: number,
  perPage?: number
): Promise<LocalGitHubRepo[]> {
  return invokeWithAuth<LocalGitHubRepo[]>("github_list_repos", {
    ...baseParams(userId, token),
    page: page ?? null,
    perPage: perPage ?? null,
  });
}

/**
 * List branches for a repository.
 */
export async function listBranchesLocal(
  userId: string,
  token: string,
  repoFullName: string
): Promise<LocalGitHubBranch[]> {
  return invokeWithAuth<LocalGitHubBranch[]>("github_list_branches", {
    ...baseParams(userId, token),
    repoFullName,
  });
}

/**
 * Create a new branch from a given SHA.
 */
export async function createBranchLocal(
  userId: string,
  token: string,
  repoFullName: string,
  branchName: string,
  fromSha: string
): Promise<string> {
  return invokeWithAuth<string>("github_create_branch", {
    ...baseParams(userId, token),
    repoFullName,
    branchName,
    fromSha,
  });
}

/**
 * Create a pull request.
 */
export async function createPRLocal(
  userId: string,
  token: string,
  repoFullName: string,
  title: string,
  head: string,
  base: string,
  body?: string,
  draft?: boolean
): Promise<LocalPRResponse> {
  return invokeWithAuth<LocalPRResponse>("github_create_pr", {
    ...baseParams(userId, token),
    repoFullName,
    title,
    head,
    base,
    body: body ?? null,
    draft: draft ?? null,
  });
}

/**
 * Clone a repository via git2 (shallow clone).
 */
export async function cloneRepoLocal(
  userId: string,
  repoFullName: string,
  targetDir: string,
  branch?: string
): Promise<string> {
  return invoke<string>("github_clone_repo", {
    userId,
    repoFullName,
    targetDir,
    branch: branch ?? null,
  });
}

export async function getGitHubGitCredentialForRemote(
  userId: string,
  remoteUrl: string
): Promise<GitHubGitCredential | null> {
  return invoke<GitHubGitCredential | null>(
    "github_git_credential_for_remote",
    {
      userId,
      remoteUrl,
    }
  );
}

/**
 * Check if a GitHub token is stored and valid.
 */
export async function checkTokenLocal(
  userId: string,
  token: string
): Promise<boolean> {
  return invokeWithAuth<boolean>("github_check_token", {
    ...baseParams(userId, token),
  });
}

/**
 * Clear the stored GitHub token (disconnect).
 */
export async function clearTokenLocal(userId: string): Promise<void> {
  await invoke("github_clear_token", { userId });
}

/**
 * Fetch full GitHub profile data locally.
 */
export async function fetchProfileLocal(
  userId: string,
  token: string
): Promise<ProfileData> {
  return invokeWithAuth<ProfileData>("github_fetch_profile", {
    ...baseParams(userId, token),
  });
}

/**
 * Detect local GitHub credentials (gh CLI, SSH keys, credential helper).
 */
export async function detectGitHubCredentials(): Promise<DetectedGitHubCredentials> {
  return invoke<DetectedGitHubCredentials>("detect_github_credentials");
}

/**
 * Validate a detected GitHub token and store it in keychain.
 */
export async function storeDetectedGitHubToken(
  userId: string,
  token: string
): Promise<StoreTokenResult> {
  return invoke<StoreTokenResult>("github_store_detected_token", {
    userId,
    token,
  });
}
