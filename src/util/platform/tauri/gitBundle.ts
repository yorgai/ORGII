/**
 * Tauri Git Bundle Module
 *
 * Creates git bundles from local repositories for hosted_key session upload.
 * Uses native Rust backend to run git bundle commands.
 *
 * Features:
 * - Preserves full git history (commits, branches)
 * - Auto-commits uncommitted changes before bundling
 * - Progress events during bundle creation
 * - Base64 encoding for transport
 *
 * This is the preferred method over ZIP archive as it preserves
 * git semantics for pull/push sync during hosted_key sessions.
 */
import {
  base64ToFile,
  ensureTauriReady,
  invokeTauri,
  isTauriReady,
  listenTauri,
} from "./init";

// ============================================
// Types
// ============================================

export interface GitBundleResult {
  /** Base64-encoded bundle data */
  data: string;
  /** Size of the bundle in bytes */
  size: number;
  /** Branch name that was bundled */
  branch_name: string;
  /** HEAD commit SHA */
  head_sha: string;
  /** Number of commits in the bundle */
  commit_count: number;
  /** Original folder name */
  folder_name: string;
}

export interface GitRepoInfo {
  /** Folder name */
  folder_name: string;
  /** Whether this is a git repository */
  is_git_repo: boolean;
  /** Current branch name (if git repo) */
  branch_name: string | null;
  /** HEAD commit SHA (if git repo) */
  head_sha: string | null;
  /** Number of commits */
  commit_count: number;
  /** Whether there are uncommitted changes */
  has_uncommitted_changes: boolean;
}

export interface BundleProgress {
  /** Current phase: checking, committed, bundling */
  phase: string;
  /** Human-readable message */
  message: string;
}

export interface GitBundleOptions {
  /** Absolute path to the git repository */
  folderPath: string;
  /** Callback for progress updates */
  onProgress?: (progress: BundleProgress) => void;
}

// ============================================
// Bundle Functions
// ============================================

/** Guard against concurrent bundle operations that would mix progress events */
let bundleInFlight = false;

/**
 * Create a git bundle from a local repository using native Tauri command
 *
 * This preserves git history and is the preferred method for hosted_key session upload.
 * Any uncommitted changes will be auto-committed before bundling.
 *
 * @param options Bundle configuration options
 * @returns Bundle result with base64-encoded bundle data
 * @throws Error if not in Tauri environment, not a git repo, or bundle fails
 *
 * @example
 * ```typescript
 * const result = await createGitBundle({
 *   folderPath: '/Users/me/project',
 * });
 * // result.data contains base64-encoded .bundle file
 * ```
 */
export async function createGitBundle(
  options: GitBundleOptions
): Promise<GitBundleResult> {
  ensureTauriReady();

  if (bundleInFlight) {
    throw new Error(
      "A git bundle operation is already in progress. Wait for it to complete."
    );
  }

  bundleInFlight = true;
  let unlisten: (() => void) | undefined;

  try {
    // Set up progress listener if callback provided
    if (options.onProgress) {
      unlisten = await listenTauri<BundleProgress>(
        "bundle-progress",
        (event) => {
          options.onProgress?.(event.payload);
        }
      );
    }
    const result = await invokeTauri<GitBundleResult>("create_git_bundle", {
      folderPath: options.folderPath,
    });

    return result;
  } catch (error) {
    console.error("[GitBundle] Bundle creation failed:", error);
    throw error;
  } finally {
    unlisten?.();
    bundleInFlight = false;
  }
}

/**
 * Get information about a git repository without creating bundle
 *
 * Useful for showing preview before bundling and checking if folder is a git repo.
 *
 * @param folderPath Absolute path to the folder
 * @returns Git repository information
 */
export async function getGitRepoInfo(folderPath: string): Promise<GitRepoInfo> {
  ensureTauriReady();

  return invokeTauri<GitRepoInfo>("get_git_repo_info", { folderPath });
}

/**
 * Convert base64-encoded bundle data to a File object
 *
 * Used to prepare the bundle for upload via FormData.
 *
 * @param result Bundle result from createGitBundle
 * @returns File object ready for upload
 *
 * @example
 * ```typescript
 * const bundle = await createGitBundle({ folderPath: '/path/to/repo' });
 * const file = bundleToFile(bundle);
 * formData.append('bundle', file);
 * ```
 */
export function bundleToFile(result: GitBundleResult): File {
  return base64ToFile(
    result.data,
    `${result.folder_name}.bundle`,
    "application/octet-stream"
  );
}

/**
 * Create bundle and convert to File in one step
 *
 * Convenience function that combines createGitBundle and bundleToFile.
 *
 * @param options Bundle configuration options
 * @returns File object ready for upload
 */
export async function createGitBundleAsFile(
  options: GitBundleOptions
): Promise<File> {
  const result = await createGitBundle(options);
  return bundleToFile(result);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if git bundle creation is available
 */
export function isBundleAvailable(): boolean {
  return isTauriReady();
}

/**
 * Create bundle with error handling - returns null on failure
 *
 * Safe version that doesn't throw on error.
 */
export async function createGitBundleSafe(
  options: GitBundleOptions
): Promise<File | null> {
  try {
    return await createGitBundleAsFile(options);
  } catch (error) {
    console.warn("[GitBundle] Bundle creation failed:", error);
    return null;
  }
}

/**
 * Check if a folder is a git repository
 *
 * @param folderPath Absolute path to the folder
 * @returns true if the folder is a git repository
 */
export async function isGitRepository(folderPath: string): Promise<boolean> {
  try {
    const info = await getGitRepoInfo(folderPath);
    return info.is_git_repo;
  } catch {
    return false;
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

// ============================================
// Git Sync Types
// ============================================

export interface ApplyBundleResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The ref that was created (e.g., "refs/remotes/cloud/main") */
  ref_name: string;
  /** Any message or error */
  message: string;
}

export interface PushBundleResult {
  /** Base64-encoded bundle data */
  data: string;
  /** Size in bytes */
  size: number;
  /** HEAD commit SHA */
  head_sha: string;
  /** Whether this is incremental or full */
  is_incremental: boolean;
}

export interface MergeResult {
  /** Whether merge succeeded */
  success: boolean;
  /** Whether there were conflicts */
  has_conflicts: boolean;
  /** Conflicting files (if any) */
  conflicting_files: string[];
  /** Message */
  message: string;
}

// ============================================
// Git Sync Functions
// ============================================

/**
 * Apply a git bundle by fetching into a remote ref
 *
 * Creates refs/remotes/cloud/{branch} without touching user's branches.
 *
 * @param folderPath Local repo path
 * @param bundleData Base64-encoded bundle data
 * @param cloudBranch Branch name from cloud
 * @returns Result with ref name
 */
export async function applyGitBundle(
  folderPath: string,
  bundleData: string,
  cloudBranch: string
): Promise<ApplyBundleResult> {
  ensureTauriReady();

  return invokeTauri<ApplyBundleResult>("apply_git_bundle", {
    folderPath,
    bundleData,
    cloudBranch,
  });
}

/**
 * Create a bundle for pushing to cloud
 *
 * @param folderPath Local repo path
 * @param baseSha Optional base commit for incremental bundle
 * @returns Bundle result with base64 data
 */
export async function createPushBundle(
  folderPath: string,
  baseSha?: string
): Promise<PushBundleResult> {
  ensureTauriReady();

  return invokeTauri<PushBundleResult>("create_push_bundle", {
    folderPath,
    baseSha: baseSha || null,
  });
}

/**
 * Merge a cloud ref into the current branch
 *
 * @param folderPath Local repo path
 * @param refName Ref to merge (e.g., "cloud/main")
 * @returns Merge result
 */
export async function mergeCloudRef(
  folderPath: string,
  refName: string
): Promise<MergeResult> {
  ensureTauriReady();

  return invokeTauri<MergeResult>("merge_cloud_ref", {
    folderPath,
    refName,
  });
}

/**
 * Get local HEAD SHA
 */
export async function getLocalHeadSha(folderPath: string): Promise<string> {
  ensureTauriReady();

  return invokeTauri<string>("get_local_head_sha", { folderPath });
}

/**
 * Get local branch name
 */
export async function getLocalBranch(folderPath: string): Promise<string> {
  ensureTauriReady();

  return invokeTauri<string>("get_local_branch", { folderPath });
}

// ============================================
// Local Commit History Types
// ============================================

export interface LocalCommitInfo {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

/**
 * Get local commit history
 *
 * Returns commits in reverse chronological order (most recent first).
 * Used for calculating ahead/behind status with remote.
 *
 * @param folderPath Local repo path
 * @param limit Maximum number of commits (default 50, max 200)
 * @returns Array of commit info
 */
export async function getLocalCommitHistory(
  folderPath: string,
  limit?: number
): Promise<LocalCommitInfo[]> {
  ensureTauriReady();

  return invokeTauri<LocalCommitInfo[]>("get_local_commit_history", {
    folderPath,
    limit: limit ?? null,
  });
}

// ============================================
// Git Operations for Conflict Resolution
// ============================================

/**
 * Stage all files in the repository (git add -A)
 *
 * @param folderPath Local repo path
 */
export async function gitAddAll(folderPath: string): Promise<void> {
  ensureTauriReady();

  await invokeTauri<void>("git_add_all", { folderPath });
}

/**
 * Create a commit with the given message
 *
 * @param folderPath Local repo path
 * @param message Commit message
 */
export async function gitCommit(
  folderPath: string,
  message: string
): Promise<void> {
  ensureTauriReady();

  await invokeTauri<void>("git_commit", { folderPath, message });
}

// ============================================
// Ahead/Behind Calculation (libgit2)
// ============================================

export interface AheadBehindStatus {
  /** Number of commits local is ahead of remote */
  ahead: number;
  /** Number of commits local is behind remote */
  behind: number;
  /** Whether local and remote are in sync */
  inSync: boolean;
}

/**
 * Calculate ahead/behind status between local HEAD and a remote SHA.
 *
 * Uses libgit2's `graph_ahead_behind()` which is O(n) where n is the
 * number of commits between the two refs — much faster than fetching
 * commit lists and comparing in JS.
 *
 * @param folderPath Path to the git repository
 * @param remoteHeadSha The remote HEAD SHA to compare against
 * @returns Ahead/behind status with counts and in_sync flag
 */
export async function calculateAheadBehind(
  folderPath: string,
  remoteHeadSha: string
): Promise<AheadBehindStatus> {
  ensureTauriReady();

  return invokeTauri<AheadBehindStatus>("calculate_ahead_behind", {
    folderPath,
    remoteHeadSha,
  });
}
