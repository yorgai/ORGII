import { fetchRustApi, gitRepoUrl } from "@src/api/http/git/client";
import { gitPush } from "@src/api/http/git/operations";
import { getGitRemotes } from "@src/api/http/git/remotes";
import {
  LOCAL_GITHUB_TOKEN_USER_ID,
  createPRLocal,
} from "@src/api/tauri/github";
import {
  SERVICE_AUTH_STORAGE_KEYS,
  getHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("createPullRequest");

/**
 * Resolve the (userId, hostedToken) pair to use for GitHub API calls.
 *
 * Priority:
 *  1. ORGII hosted session — userId + token from localStorage (full OAuth flow)
 *  2. Local GitHub token  — stored via gh CLI / local detect under LOCAL_GITHUB_TOKEN_USER_ID
 *     In this case we pass an empty hosted token; the Rust client will look up the
 *     token from ~/.orgii/github_tokens.json directly instead of calling the refresh endpoint.
 */
function resolveGitHubAuth(): { userId: string; token: string } | null {
  const hostedToken = getHostedToken();
  const hostedUserId = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.userId);
  if (hostedToken && hostedUserId) {
    return { userId: hostedUserId, token: hostedToken };
  }
  // Fallback: local GitHub token stored under LOCAL_GITHUB_TOKEN_USER_ID
  return { userId: LOCAL_GITHUB_TOKEN_USER_ID, token: "" };
}

export function parseGithubRepoFullName(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

export interface CreatePullRequestParams {
  repoPath: string;
  branch: string;
  title: string;
  repoId?: string;
  pushBeforeCreate?: boolean;
}

export interface CreatePullRequestResult {
  url?: string;
  error?: string;
}

export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<CreatePullRequestResult> {
  const {
    repoPath,
    branch,
    title,
    repoId = "default",
    pushBeforeCreate = true,
  } = params;

  const auth = resolveGitHubAuth();
  if (!auth) {
    return { error: "not_authenticated" };
  }
  const { userId, token } = auth;

  try {
    const remotesData = await getGitRemotes({
      repo_id: repoId,
      repo_path: repoPath,
    });
    const originRemote = remotesData?.remotes?.find(
      (remote) => remote.name === "origin"
    );
    if (!originRemote?.url) {
      return { error: "no_origin_remote" };
    }

    const repoFullName = parseGithubRepoFullName(originRemote.url);
    if (!repoFullName) {
      return { error: "cannot_parse_repo_name" };
    }

    if (pushBeforeCreate) {
      await gitPush({
        repo_id: repoId,
        repo_path: repoPath,
        remote: "origin",
        branch,
        set_upstream: true,
      });
    }

    let baseBranch = "main";
    try {
      const queryParams = new URLSearchParams({ path: repoPath });
      const branchResp = await fetchRustApi<{ name: string }>(
        `${gitRepoUrl(repoId)}/default-branch?${queryParams.toString()}`
      );
      if (branchResp.data?.name) {
        baseBranch = branchResp.data.name;
      }
    } catch {
      // Fallback to "main" if detection fails
    }

    const prResponse = await createPRLocal(
      userId,
      token,
      repoFullName,
      title,
      branch,
      baseBranch
    );

    return { url: prResponse.url };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to create PR: ${msg}`);
    return { error: msg };
  }
}
