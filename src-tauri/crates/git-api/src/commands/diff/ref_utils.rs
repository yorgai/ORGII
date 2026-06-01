//! Shared ref-resolution utilities for diff operations.

use git2::Repository;

/// Resolve a `from_ref` string to an `Option<git2::Tree>`.
///
/// Special sentinel values:
///   `"STAGED"` / `"INDEX"` → `None`  (diff against the index)
///   `"EMPTY"`              → `None`  (empty base — show everything as new)
///
/// For any other ref string, the ref is resolved normally.  **When the ref is
/// `"HEAD"` and the repository has no commits yet (unborn branch), this
/// function transparently falls back to `None` instead of returning an error.**
/// This lets every diff/numstat caller use `from_ref = "HEAD"` unconditionally
/// and still work correctly on brand-new agent-created repositories.
pub fn resolve_from_ref<'repo>(
    repo: &'repo Repository,
    from_ref: &str,
) -> Result<Option<git2::Tree<'repo>>, String> {
    match from_ref {
        "STAGED" | "INDEX" | "EMPTY" => Ok(None),
        ref_str => {
            match repo.revparse_single(ref_str) {
                Ok(obj) => {
                    let commit = obj
                        .peel_to_commit()
                        .map_err(|e| format!("Failed to get commit: {}", e))?;
                    let tree = commit
                        .tree()
                        .map_err(|e| format!("Failed to get tree: {}", e))?;
                    Ok(Some(tree))
                }
                Err(e) => {
                    // Transparent fallback: if HEAD doesn't exist (unborn branch /
                    // no commits yet) treat it as an empty base so diffs still
                    // render all files as new additions instead of erroring.
                    if ref_str == "HEAD"
                        && (e.message().contains("not found")
                            || e.message().contains("revspec")
                            || e.code() == git2::ErrorCode::NotFound
                            || e.code() == git2::ErrorCode::UnbornBranch)
                    {
                        return Ok(None);
                    }
                    Err(format!("Failed to resolve ref '{}': {}", ref_str, e))
                }
            }
        }
    }
}

/// Returns `true` when `from_ref` maps to an empty base (no old tree).
/// Used by callers that need to set `include_untracked` on `DiffOptions`.
pub fn is_empty_base(from_ref: &str) -> bool {
    matches!(from_ref, "STAGED" | "INDEX" | "EMPTY")
}
