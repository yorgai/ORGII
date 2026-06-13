use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::CodeMapError;

pub fn canonical_workspace(path: &Path) -> Result<PathBuf, CodeMapError> {
    path.canonicalize()
        .map_err(|source| CodeMapError::PathCanonicalize {
            path: path.to_path_buf(),
            source,
        })
}

pub fn workspace_key(canonical_root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_root.to_string_lossy().as_bytes());
    hex::encode(hasher.finalize())
}

pub fn db_path_for_workspace(canonical_root: &Path) -> Result<PathBuf, CodeMapError> {
    let root = app_paths::code_map_root();
    std::fs::create_dir_all(&root).map_err(|source| CodeMapError::CreateDir {
        path: root.clone(),
        source,
    })?;
    Ok(root.join(format!("{}.sqlite", workspace_key(canonical_root))))
}

pub fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
