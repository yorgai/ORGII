/**
 * GitService - Singleton Git Operations Service
 *
 * Provides git capabilities shared by both AI and UI.
 * Supports two modes:
 *   1. Terminal commands (for AI/natural language - shows output)
 *   2. API calls (for programmatic use - returns results)
 *
 * Usage:
 *   import { GitService } from "@src/services/git";
 *   GitService.setRepoContext(repoId, repoPath);
 *   await GitService.commit("fix: resolve bug");
 */
import { gitApi } from "@src/api/http/git";
import { createLogger } from "@src/hooks/logger";
import {
  appendGitCoauthorTrailer,
  shouldIncludeGitCoauthor,
} from "@src/services/git/operations/commitAttribution";
import { TerminalService } from "@src/services/terminal";

const logger = createLogger("GitService");

// ============================================
// Repo Context Storage
// ============================================

let repoContext: { repoId: string; repoPath: string } | null = null;

// ============================================
// GitService - Singleton API
// ============================================

export const GitService = {
  /**
   * Set the repository context (required for API-based operations)
   */
  setRepoContext(repoId: string, repoPath: string): void {
    repoContext = { repoId, repoPath };
  },

  /**
   * Get the current repository context
   */
  getRepoContext(): { repoId: string; repoPath: string } | null {
    return repoContext;
  },
  /**
   * Run `git status` in the terminal. The pinned `source-control` tab is
   * always present in the editor pane and brings the Source Control sidebar
   * with it, so we don't need to flip a sidebar tab here.
   */
  async status(): Promise<void> {
    await TerminalService.execute("git status");
  },

  /**
   * Stage files for commit
   * @param paths - File paths to stage (defaults to all)
   */
  async stage(paths?: string[]): Promise<void> {
    const pathsStr = paths?.join(" ") || ".";
    await TerminalService.execute(`git add ${pathsStr}`);
  },

  /**
   * Unstage files
   * @param paths - File paths to unstage (defaults to all)
   */
  async unstage(paths?: string[]): Promise<void> {
    const pathsStr = paths?.join(" ") || ".";
    await TerminalService.execute(`git reset HEAD ${pathsStr}`);
  },

  /**
   * Commit staged changes
   * @param message - Commit message
   */
  async commit(message: string): Promise<void> {
    const commitMessage = appendGitCoauthorTrailer(message);
    const escapedMsg = commitMessage.replace(/"/g, '\\"');
    await TerminalService.execute(`git commit -m "${escapedMsg}"`);
  },

  /**
   * Push to remote
   * @param force - Force push (dangerous)
   */
  async push(force?: boolean): Promise<void> {
    const cmd = force ? "git push --force" : "git push";
    await TerminalService.execute(cmd);
  },

  /**
   * Pull from remote
   */
  async pull(): Promise<void> {
    await TerminalService.execute("git pull");
  },

  /**
   * Fetch from remote
   */
  async fetch(): Promise<void> {
    await TerminalService.execute("git fetch");
  },

  /**
   * Checkout a branch
   * @param branch - Branch name
   * @param create - Create new branch
   */
  async checkout(branch: string, create?: boolean): Promise<void> {
    const cmd = create ? `git checkout -b ${branch}` : `git checkout ${branch}`;
    await TerminalService.execute(cmd);
  },

  /**
   * Show diff
   * @param path - File path (optional, defaults to all)
   */
  async diff(path?: string): Promise<void> {
    const cmd = path ? `git diff ${path}` : "git diff";
    await TerminalService.execute(cmd);
  },

  /**
   * Discard changes to a file
   * @param path - File path to discard
   */
  async discard(path: string): Promise<void> {
    await TerminalService.execute(`git checkout -- ${path}`);
  },

  /**
   * Stash current changes
   * @param message - Optional stash message
   */
  async stash(message?: string): Promise<void> {
    const cmd = message ? `git stash push -m "${message}"` : "git stash";
    await TerminalService.execute(cmd);
  },

  /**
   * Pop latest stash
   */
  async stashPop(): Promise<void> {
    await TerminalService.execute("git stash pop");
  },

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    if (!repoContext) {
      logger.warn("getCurrentBranch: repo context not set");
      return "";
    }
    try {
      const status = await gitApi.getGitStatus({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        include_untracked: false,
      });
      return status?.current_branch ?? "";
    } catch (err) {
      logger.error("getCurrentBranch failed:", err);
      return "";
    }
  },

  /**
   * List branches
   */
  async listBranches(): Promise<void> {
    await TerminalService.execute("git branch -a");
  },

  // ==========================================
  // API-based Operations (programmatic, no terminal output)
  // ==========================================

  /**
   * Stage files using API (for programmatic use)
   * @param paths - File paths to stage
   */
  async stageFiles(paths: string[]): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      await gitApi.gitStageFiles({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        files: paths,
      });
      return true;
    } catch (error) {
      logger.error("Failed to stage files:", error);
      return false;
    }
  },

  /**
   * Unstage files using API
   * @param paths - File paths to unstage
   */
  async unstageFiles(paths: string[]): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      await gitApi.gitUnstageFiles({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        files: paths,
      });
      return true;
    } catch (error) {
      logger.error("Failed to unstage files:", error);
      return false;
    }
  },

  /**
   * Discard changes to files using API
   * @param paths - File paths to discard
   */
  async discardChanges(paths: string[]): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      await gitApi.gitDiscardChanges({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        files: paths,
      });
      return true;
    } catch (error) {
      logger.error("Failed to discard changes:", error);
      return false;
    }
  },

  /**
   * Commit staged changes using API
   * @param message - Commit message
   */
  async commitApi(message: string): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitCommit({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        message: appendGitCoauthorTrailer(message),
        coauthor: shouldIncludeGitCoauthor(),
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to commit:", error);
      return false;
    }
  },

  /**
   * Push to remote using API
   * @param force - Force push
   */
  async pushApi(force = false): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitPush({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        force,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to push:", error);
      return false;
    }
  },

  /**
   * Pull from remote using API
   */
  async pullApi(): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitPull({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to pull:", error);
      return false;
    }
  },

  /**
   * Sync (pull + push) using API
   */
  async sync(): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      // Pull first
      const pullResult = await gitApi.gitPull({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
      });
      if (!pullResult?.success) {
        logger.error("Sync failed at pull");
        return false;
      }

      // Then push
      const pushResult = await gitApi.gitPush({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        force: false,
      });
      if (!pushResult?.success) {
        logger.error("Sync failed at push");
        return false;
      }

      return true;
    } catch (error) {
      logger.error("Failed to sync:", error);
      return false;
    }
  },

  /**
   * Publish branch (push with --set-upstream)
   */
  async publish(): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitPush({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        force: false,
        set_upstream: true,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to publish:", error);
      return false;
    }
  },

  /**
   * Create a stash using API
   * @param message - Optional stash message
   * @param includeUntracked - Include untracked files
   */
  async stashPush(
    message?: string,
    includeUntracked = false
  ): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitStashPush({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        message: message ?? null,
        include_untracked: includeUntracked,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to stash push:", error);
      return false;
    }
  },

  /**
   * Apply a stash using API
   * @param index - Stash index
   */
  async stashApply(index: number): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitStashApply({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        index,
        pop: false,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to apply stash:", error);
      return false;
    }
  },

  /**
   * Pop a stash (apply and remove) using API
   * @param index - Stash index
   */
  async stashPopApi(index = 0): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitStashApply({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        index,
        pop: true,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to pop stash:", error);
      return false;
    }
  },

  /**
   * Drop a stash using API
   * @param index - Stash index
   */
  async stashDrop(index: number): Promise<boolean> {
    if (!repoContext) {
      logger.error("Repo context not set");
      return false;
    }
    try {
      const result = await gitApi.gitStashDrop({
        repo_id: repoContext.repoId,
        repo_path: repoContext.repoPath,
        index,
      });
      return result?.success ?? false;
    } catch (error) {
      logger.error("Failed to drop stash:", error);
      return false;
    }
  },
};

export default GitService;
