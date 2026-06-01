//! Merkle tree persistence (save/load snapshots to disk).

use std::path::PathBuf;

use anyhow::{Context, Result};

use super::tree::MerkleTree;

/// Directory where Merkle snapshots are stored.
fn merkle_dir() -> PathBuf {
    app_paths::merkle_root()
}

/// Sanitize repo_id into a safe filename.
/// Repo IDs can be absolute paths (e.g. `/Users/x/my-repo`); joining an
/// absolute path with `PathBuf::join` replaces the base entirely.
fn safe_filename(repo_id: &str) -> String {
    repo_id
        .replace(['/', '\\'], "_")
        .trim_start_matches('_')
        .to_string()
}

/// Path to a specific repo's Merkle snapshot.
fn snapshot_path(repo_id: &str) -> PathBuf {
    merkle_dir().join(format!("{}.json", safe_filename(repo_id)))
}

/// Save a Merkle tree snapshot to disk.
pub fn save_snapshot(repo_id: &str, tree: &MerkleTree) -> Result<()> {
    let dir = merkle_dir();
    std::fs::create_dir_all(&dir).context("Failed to create merkle snapshot directory")?;

    let path = snapshot_path(repo_id);
    let data = serde_json::to_vec(tree).context("Failed to serialize Merkle tree")?;
    std::fs::write(&path, data).context("Failed to write Merkle snapshot")?;

    Ok(())
}

/// Load a Merkle tree snapshot from disk.
pub fn load_snapshot(repo_id: &str) -> Result<Option<MerkleTree>> {
    let path = snapshot_path(repo_id);
    if !path.exists() {
        return Ok(None);
    }

    let data = std::fs::read(&path).context("Failed to read Merkle snapshot")?;
    let tree: MerkleTree =
        serde_json::from_slice(&data).context("Failed to deserialize Merkle snapshot")?;

    Ok(Some(tree))
}
