use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

pub fn file_metadata_signature(path: &Path, source_name: &str) -> Result<(i64, i64), String> {
    let metadata = path
        .metadata()
        .map_err(|err| format!("Failed to read {source_name} file metadata: {err}"))?;
    let modified_at_ms = metadata
        .modified()
        .map_err(|err| format!("Failed to read {source_name} file modified time: {err}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("{source_name} file modified time is before Unix epoch: {err}"))?
        .as_millis() as i64;
    Ok((modified_at_ms, metadata.len() as i64))
}
