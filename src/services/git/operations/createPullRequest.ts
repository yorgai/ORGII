import { fetchRustApi, gitRepoUrl } from "@src/api/http/git/client";
import { gitPush } from "@src/api/http/git/operations";
import { getGitRemotes } from "@src/api/http/git/remotes";
import {
  LOCAL_GITHUB_TOKEN_USER_ID,
  createPRLocal,
  getGitHubGitCredentialForRemote,
} from "@src/api/tauri/github";
import {
  SERVICE_AUTH_STORAGE_KEYS,
  getHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("createPullRequest");

async function resolveGitHubAuth(
  remoteUrl: string
): Promise<{ userId: string; token: string } | null> {
  const hostedToken = getHostedToken();
  const hostedUserId = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.userId);
  if (hostedToken && hostedUserId) {
    return { userId: hostedUserId, token: hostedToken };
  }

  try {
    const credential = await getGitHubGitCredentialForRemote(
      LOCAL_GITHUB_TOKEN_USER_ID,
      remoteUrl
    );
    if (credential) {
      return { userId: LOCAL_GITHUB_TOKEN_USER_ID, token: credential.token };
    }
  } catch (error) {
    logger.warn("Local git credential lookup failed:", error);
  }

  return null;
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

    const auth = await resolveGitHubAuth(originRemote.url);
    if (!auth) {
      return { error: "not_authenticated" };
    }
    const { userId, token } = auth;

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
