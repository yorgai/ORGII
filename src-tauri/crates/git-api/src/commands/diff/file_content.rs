use crate::types::*;
use git2::Repository;
use std::path::Path;

/// Get file content at a specific ref
pub fn get_file_content(
    repo_path: &Path,
    file_path: &str,
    git_ref: &str,
) -> Result<GitFileContentResult, String> {
    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    // Resolve the reference to a commit
    let obj = repo
        .revparse_single(git_ref)
        .map_err(|e| format!("Failed to resolve ref '{}': {}", git_ref, e))?;

    let commit = obj
        .peel_to_commit()
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let entry = match tree.get_path(Path::new(file_path)) {
        Ok(entry) => entry,
        Err(_) => {
            return Ok(GitFileContentResult {
                content: String::new(),
                encoding: "utf-8".to_string(),
                git_ref: git_ref.to_string(),
                file_path: file_path.to_string(),
                size: 0,
                exists: false,
            });
        }
    };

    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Failed to get blob: {}", e))?;

    let raw = blob.content();
    let size = blob.size();

    // Detect binary content (null bytes in first 8KB)
    let is_binary = raw.iter().take(8000).any(|&b| b == 0);

    let (content, encoding) = if is_binary {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        (STANDARD.encode(raw), "base64".to_string())
    } else {
        (
            String::from_utf8_lossy(raw).to_string(),
            "utf-8".to_string(),
        )
    };

    Ok(GitFileContentResult {
        content,
        encoding,
        git_ref: git_ref.to_string(),
        file_path: file_path.to_string(),
        size,
        exists: true,
    })
}
