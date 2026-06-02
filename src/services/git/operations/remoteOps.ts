/**
 * Remote Operations — push, pull, fetch, publish, sync
 */
import { gitApi } from "@src/api/http/git";
import { showGitErrorAndHandle } from "@src/hooks/git/useGitErrorDialog";
import { gitPullStrategyAtom } from "@src/store/ui/editorSettingsAtom";
import { showGitAuthenticationDialog } from "@src/util/dialogs/gitAuthenticationDialog";

import { TerminalService } from "../../terminal";
import type { GitOperationResult } from "./types";
import {
  getOutputIntegration,
  getRepoContext,
  getStore,
  parseGitError,
} from "./types";

// ============================================
// Core Operations
// ============================================

/**
 * Push to remote
 * Uses streaming output if available, falls back to terminal
 */
export async function push(
  params: {
    force?: boolean;
    setUpstream?: boolean;
    remote?: string;
    branch?: string;
  } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();

  if (integration) {
    const result = await integration.pushWithOutput({
      remote: params.remote,
      branch: params.branch,
      force: params.force,
      set_upstream: params.setUpstream,
    });
    if (!result.success && result.errorType === "authentication_failed") {
      return (await retryPushWithAuth(params)) ?? result;
    }
    return result;
  }

  const repo = getRepoContext();
  if (repo) {
    try {
      await gitApi.gitPush({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        branch: params.branch,
        force: params.force,
        set_upstream: params.setUpstream,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (await retryPushWithAuth(params)) ?? result;
      }
      return result;
    }
  }

  // Fall back to terminal command
  const cmd = params.force ? "git push --force" : "git push";
  try {
    await TerminalService.execute(cmd);
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

/**
 * Read the user's preferred pull strategy from settings
 */
function getUserPullStrategy(): string {
  const strategy = getStore().get(gitPullStrategyAtom);
  return strategy ?? "merge";
}

/**
 * Build the terminal pull command with strategy flags.
 * Always pass explicit flag so Git knows how to reconcile when branches diverge.
 */
function buildPullCommand(strategy: string): string {
  switch (strategy) {
    case "rebase":
      return "git pull --rebase";
    case "ff-only":
      return "git pull --ff-only";
    default:
      return "git pull --no-rebase";
  }
}

async function requestGitAuthToken(
  operation: "push" | "pull" | "fetch" | "sync",
  remote?: string
): Promise<{ username: string; token: string } | null> {
  const repo = getRepoContext();
  return showGitAuthenticationDialog({
    operation,
    repoPath: repo?.repoPath,
    remote,
  });
}

async function retryPushWithAuth(params: {
  force?: boolean;
  setUpstream?: boolean;
  remote?: string;
  branch?: string;
}): Promise<GitOperationResult | null> {
  const repo = getRepoContext();
  if (!repo) return null;

  const auth = await requestGitAuthToken("push", params.remote);
  if (!auth) return null;

  try {
    await gitApi.gitPush({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      branch: params.branch,
      force: params.force,
      set_upstream: params.setUpstream,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

async function retryPullWithAuth(params: {
  remote?: string;
  branch?: string;
  strategy: string;
}): Promise<GitOperationResult | null> {
  const repo = getRepoContext();
  if (!repo) return null;

  const auth = await requestGitAuthToken("pull", params.remote);
  if (!auth) return null;

  try {
    await gitApi.gitPull({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      branch: params.branch,
      strategy: params.strategy,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

async function retryFetchWithAuth(params: {
  remote?: string;
  prune?: boolean;
}): Promise<GitOperationResult | null> {
  const repo = getRepoContext();
  if (!repo) return null;

  const auth = await requestGitAuthToken("fetch", params.remote);
  if (!auth) return null;

  try {
    await gitApi.gitFetch({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      prune: params.prune,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

/**
 * Pull from remote
 * Uses streaming output if available, falls back to terminal.
 * Respects the user's pull strategy setting (merge/rebase/ff-only).
 */
export async function pull(
  params: {
    remote?: string;
    branch?: string;
  } = {}
): Promise<GitOperationResult> {
  const strategy = getUserPullStrategy();
  const integration = getOutputIntegration();

  if (integration) {
    const result = await integration.pullWithOutput({ ...params, strategy });
    if (!result.success && result.errorType === "authentication_failed") {
      return (await retryPullWithAuth({ ...params, strategy })) ?? result;
    }
    return result;
  }

  const repo = getRepoContext();
  if (repo) {
    try {
      await gitApi.gitPull({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        branch: params.branch,
        strategy,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (await retryPullWithAuth({ ...params, strategy })) ?? result;
      }
      return result;
    }
  }

  try {
    await TerminalService.execute(buildPullCommand(strategy));
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

/**
 * Fetch from remote
 * Uses streaming output if available, falls back to terminal
 */
export async function fetch(
  params: {
    remote?: string;
    prune?: boolean;
  } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();

  if (integration) {
    const result = await integration.fetchWithOutput(params);
    if (!result.success && result.errorType === "authentication_failed") {
      return (await retryFetchWithAuth(params)) ?? result;
    }
    return result;
  }

  const repo = getRepoContext();
  if (repo) {
    try {
      await gitApi.gitFetch({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        prune: params.prune,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (await retryFetchWithAuth(params)) ?? result;
      }
      return result;
    }
  }

  try {
    await TerminalService.execute("git fetch");
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

/**
 * Publish branch (push with --set-upstream)
 */
export async function publish(): Promise<GitOperationResult> {
  return push({ setUpstream: true });
}

/**
 * Sync (fetch → pull → push)
 *
 * Fetches first so local tracking refs are up-to-date before pull+push.
 * Without the preflight fetch, `git status` may report 0 behind while
 * the remote actually has new commits, causing a push rejection.
 */
export async function sync(): Promise<GitOperationResult> {
  const fetchResult = await fetch();
  if (!fetchResult.success) {
    return fetchResult;
  }
  const pullResult = await pull();
  if (!pullResult.success) {
    return pullResult;
  }
  return push();
}

// ============================================
// Operations with Error Dialog
// ============================================

/**
 * Defer native dialog display to the next event-loop tick.
 * Calling the Tauri dialog API synchronously from a WebKit event callback
 * (e.g. SSE end, fetch settlement) can trigger a main-thread rendering
 * mutex self-deadlock on macOS.
 */
function deferErrorDialog(
  options: Parameters<typeof showGitErrorAndHandle>[0]
) {
  setTimeout(() => {
    showGitErrorAndHandle(options);
  }, 0);
}

/**
 * Push to remote with error dialog on failure
 */
export async function pushWithDialog(
  params: { force?: boolean; setUpstream?: boolean } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await push(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "push",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Push failed",
    });
  }
  return result;
}

/**
 * Pull from remote with error dialog on failure
 */
export async function pullWithDialog(
  params: { remote?: string; branch?: string } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await pull(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "pull",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Pull failed",
    });
  }
  return result;
}

/**
 * Fetch from remote with error dialog on failure
 */
export async function fetchWithDialog(
  params: { remote?: string; prune?: boolean } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await fetch(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "fetch",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Fetch failed",
    });
  }
  return result;
}

/**
 * Sync (pull + push) with error dialog on failure
 */
export async function syncWithDialog(): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await sync();

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "sync",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Sync failed",
    });
  }
  return result;
}
