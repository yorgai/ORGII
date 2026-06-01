/**
 * Merkle Tree API
 *
 * File change detection via Merkle tree snapshots.
 * Used for efficient cold-diff on app startup and branch switches.
 */
import { invoke } from "@tauri-apps/api/core";

// ============================================
// Types
// ============================================

export interface MerkleChange {
  path: string;
  change_type: "Added" | "Modified" | "Deleted";
}

export interface MerkleDiffResult {
  changes: MerkleChange[];
  file_count: number;
  built_at_ms: number;
}

export interface MerkleStats {
  file_count: number;
  built_at_ms: number;
  has_snapshot: boolean;
}

// ============================================
// Commands
// ============================================

function normalizePath(repoPath: string): string {
  const stripped = repoPath.startsWith("file://")
    ? repoPath.slice(7)
    : repoPath;
  return decodeURIComponent(stripped);
}

/**
 * Build a Merkle tree for a repository and save the snapshot.
 */
export async function merkleBuildTree(
  repoId: string,
  repoPath: string
): Promise<MerkleStats> {
  return invoke<MerkleStats>("merkle_build_tree", {
    repoId,
    repoPath: normalizePath(repoPath),
  });
}

/**
 * Diff the current file system against the last saved Merkle snapshot.
 * Returns the list of changed files and saves a new snapshot.
 */
export async function merkleDiffSinceSnapshot(
  repoId: string,
  repoPath: string
): Promise<MerkleDiffResult> {
  return invoke<MerkleDiffResult>("merkle_diff_since_snapshot", {
    repoId,
    repoPath: normalizePath(repoPath),
  });
}

/**
 * Get stats about the Merkle snapshot for a repo.
 */
export async function merkleGetStats(repoId: string): Promise<MerkleStats> {
  return invoke<MerkleStats>("merkle_get_stats", { repoId });
}
