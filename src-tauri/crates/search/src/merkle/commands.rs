//! Tauri commands for Merkle tree operations.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::diff::{diff_trees, MerkleChange};
use super::persistence;
use super::tree::MerkleTree;

#[derive(Debug, Serialize, Deserialize)]
pub struct MerkleDiffResult {
    pub changes: Vec<MerkleChange>,
    pub file_count: usize,
    pub built_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MerkleStats {
    pub file_count: usize,
    pub built_at_ms: u64,
    pub has_snapshot: bool,
}

/// Build a Merkle tree for a repository and save the snapshot.
#[tauri::command]
pub async fn merkle_build_tree(repo_id: String, repo_path: String) -> Result<MerkleStats, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        if !path.exists() {
            return Err(format!("Repository path does not exist: {}", repo_path));
        }

        let tree =
            MerkleTree::build(&path).map_err(|e| format!("Failed to build Merkle tree: {}", e))?;

        let stats = MerkleStats {
            file_count: tree.file_count,
            built_at_ms: tree.built_at_ms,
            has_snapshot: true,
        };

        persistence::save_snapshot(&repo_id, &tree)
            .map_err(|e| format!("Failed to save Merkle snapshot: {}", e))?;

        println!(
            "🌳 [Merkle] Built tree for {}: {} files",
            repo_id, tree.file_count
        );

        Ok(stats)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Diff the current file system against the last saved snapshot.
/// Returns the list of changed files and saves a new snapshot.
#[tauri::command]
pub async fn merkle_diff_since_snapshot(
    repo_id: String,
    repo_path: String,
) -> Result<MerkleDiffResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        if !path.exists() {
            return Err(format!("Repository path does not exist: {}", repo_path));
        }

        let new_tree = MerkleTree::build(&path)
            .map_err(|e| format!("Failed to build current Merkle tree: {}", e))?;

        let changes = match persistence::load_snapshot(&repo_id) {
            Ok(Some(old_tree)) => diff_trees(&old_tree.root, &new_tree.root),
            Ok(None) => Vec::new(),
            Err(err) => {
                tracing::warn!(
                    "Failed to load old Merkle snapshot, treating as fresh: {}",
                    err
                );
                Vec::new()
            }
        };

        persistence::save_snapshot(&repo_id, &new_tree)
            .map_err(|e| format!("Failed to save Merkle snapshot: {}", e))?;

        if !changes.is_empty() {
            println!(
                "🌳 [Merkle] Diff for {}: {} changes detected",
                repo_id,
                changes.len()
            );
        }

        Ok(MerkleDiffResult {
            changes,
            file_count: new_tree.file_count,
            built_at_ms: new_tree.built_at_ms,
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Get stats about the Merkle snapshot for a repo.
#[tauri::command]
pub fn merkle_get_stats(repo_id: String) -> Result<MerkleStats, String> {
    match persistence::load_snapshot(&repo_id) {
        Ok(Some(tree)) => Ok(MerkleStats {
            file_count: tree.file_count,
            built_at_ms: tree.built_at_ms,
            has_snapshot: true,
        }),
        Ok(None) => Ok(MerkleStats {
            file_count: 0,
            built_at_ms: 0,
            has_snapshot: false,
        }),
        Err(err) => Err(format!("Failed to load Merkle snapshot: {}", err)),
    }
}
