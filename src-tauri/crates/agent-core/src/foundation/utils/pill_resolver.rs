//! Resolve pill references embedded in user messages.
//!
//! The frontend serializes pill nodes (file, folder, project, repo, branch)
//! into bracketed references like `[file:path]`, `[folder:path]`, etc.
//! These are opaque to the LLM. This module expands them into readable
//! context blocks so the agent can actually see the referenced content.
//!
//! Reference formats (from `TiptapInput/utils.ts`):
//!   - `[file:/absolute/path]`           → read file content
//!   - `[file:project-slug/ITEM-ID]`       → resolve as global work item
//!   - `[folder:/absolute/path]`         → list directory
//!   - `[project:project-slug]`              → read project metadata
//!   - `[repo:path]`, `[branch:path]`    → informational (no expansion needed)
//!   - `[type:path::base64]`             → already carries inline content

use regex::Regex;
use std::path::Path;
use std::sync::LazyLock;

static PILL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[(file|folder|project|repo|branch):([^\]]+)\]").expect("valid regex")
});

/// Resolved reference with its content.
struct ResolvedRef {
    content: String,
}

/// Expand pill references in a user message, returning the enriched message.
///
/// - `message`: the raw user message containing `[type:path]` references
/// - `workspace`: the agent workspace root (used as a fallback for relative file paths)
/// - `ide_repo_path`: the active IDE repo path (if different from workspace)
/// - `workspace_folders`: all workspace folder roots for multi-root support
pub fn expand_pill_references(
    message: &str,
    workspace: &Path,
    ide_repo_path: Option<&str>,
    workspace_folders: &[String],
) -> String {
    let mut resolved: Vec<ResolvedRef> = Vec::new();

    for cap in PILL_RE.captures_iter(message) {
        let _full_match = cap.get(0).unwrap().as_str();
        let ref_type = &cap[1];
        let ref_path = &cap[2];

        // Skip references that already carry inline content (base64 encoded)
        if ref_path.contains("::") {
            continue;
        }

        let content = match ref_type {
            "file" => resolve_file_ref(ref_path, workspace, ide_repo_path, workspace_folders),
            "folder" => resolve_folder_ref(ref_path, workspace),
            "project" => resolve_project_ref(ref_path),
            other => {
                // Unknown pill ref_type. Surface it so a frontend that
                // starts emitting a new pill kind without backend
                // coverage is visible in logs instead of having every
                // such pill silently disappear from the LLM prompt.
                tracing::warn!(
                    "[pill_resolver] unknown pill ref_type {:?} (path={:?}); pill skipped",
                    other,
                    ref_path
                );
                None
            }
        };

        if let Some(content) = content {
            resolved.push(ResolvedRef { content });
        }
    }

    if resolved.is_empty() {
        return message.to_string();
    }

    let mut context_blocks = Vec::new();
    for r in &resolved {
        context_blocks.push(r.content.clone());
    }

    format!(
        "{}\n\n---\n**Referenced content (auto-expanded):**\n\n{}",
        message,
        context_blocks.join("\n\n")
    )
}

/// Resolve a `[file:path]` reference.
fn resolve_file_ref(
    path: &str,
    workspace: &Path,
    _ide_repo_path: Option<&str>,
    _workspace_folders: &[String],
) -> Option<String> {
    // Pattern 1: relative path like "project-slug/ITEM-ID" → work item
    if !path.starts_with('/') && !path.starts_with('.') {
        if let Some(content) = try_resolve_work_item(path) {
            return Some(content);
        }
    }

    // Pattern 2: absolute path → read the file directly
    if path.starts_with('/') {
        return read_file_preview(Path::new(path));
    }

    // Pattern 3: relative path → resolve against workspace
    let abs_path = workspace.join(path);
    if abs_path.exists() {
        return read_file_preview(&abs_path);
    }

    None
}

/// Try to resolve a relative path as a global work item reference.
///
/// Handles formats like:
///   - `project-1/MAR-0014`  → work item `MAR-0014` inside project `project-1`
///   - `project-slug/ITEM`   → work item `ITEM` inside project `project-slug`
fn try_resolve_work_item(ref_path: &str) -> Option<String> {
    let parts: Vec<&str> = ref_path.splitn(2, '/').collect();
    if parts.len() != 2 {
        return None;
    }
    let (project_slug, item_id) = (parts[0], parts[1]);

    let work_item = project_management::projects::io::read_work_item(project_slug, item_id).ok()?;
    let yaml = serde_yaml::to_string(&work_item.frontmatter).ok()?;
    Some(format!(
        "### Work Item: {} (project: {})\n\n```yaml\n{}\n```\n\n{}",
        item_id,
        project_slug,
        yaml,
        truncate_content(&work_item.body, 4000),
    ))
}

/// Resolve a `[folder:path]` reference by listing its contents.
fn resolve_folder_ref(path: &str, workspace: &Path) -> Option<String> {
    let abs_path = if path.starts_with('/') {
        std::path::PathBuf::from(path)
    } else {
        workspace.join(path)
    };

    if !abs_path.is_dir() {
        return None;
    }

    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(&abs_path) {
        for entry in read_dir.flatten().take(50) {
            let name = entry.file_name().to_string_lossy().to_string();
            let kind = if entry.path().is_dir() {
                "[dir]"
            } else {
                "[file]"
            };
            entries.push(format!("{} {}", kind, name));
        }
    }

    if entries.is_empty() {
        return None;
    }

    entries.sort();
    Some(format!(
        "### Folder: {}\n```\n{}\n```",
        abs_path.display(),
        entries.join("\n"),
    ))
}

/// Resolve a `[project:slug]` reference by reading project metadata.
fn resolve_project_ref(slug: &str) -> Option<String> {
    let project = project_management::projects::io::read_project(slug).ok()?;
    let yaml = serde_yaml::to_string(&project.meta).ok()?;
    Some(format!(
        "### Project: {}\n\n```yaml\n{}\n```",
        slug,
        truncate_content(&yaml, 2000),
    ))
}

/// Read a file with a size cap for context injection.
fn read_file_preview(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }

    // Skip binary/large files
    if let Ok(meta) = path.metadata() {
        if meta.len() > 100_000 {
            return Some(format!(
                "### File: {}\n*(File too large: {} bytes — showing path only)*",
                path.display(),
                meta.len(),
            ));
        }
    }

    match std::fs::read_to_string(path) {
        Ok(content) => {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            Some(format!(
                "### File: {}\n```{}\n{}\n```",
                path.display(),
                ext,
                truncate_content(&content, 4000),
            ))
        }
        Err(_) => Some(format!(
            "### File: {}\n*(Binary or unreadable file)*",
            path.display(),
        )),
    }
}

/// Truncate content to a maximum byte length, snapping to a char boundary.
fn truncate_content(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_pills_unchanged() {
        let msg = "Hello, how are you?";
        let result = expand_pill_references(msg, Path::new("/tmp"), None, &[]);
        assert_eq!(result, msg);
    }

    #[test]
    fn test_base64_pills_skipped() {
        let msg = "See this [terminal:term-1::dGVzdA==]";
        let result = expand_pill_references(msg, Path::new("/tmp"), None, &[]);
        assert_eq!(result, msg);
    }

    #[test]
    fn test_repo_branch_not_expanded() {
        let msg = "Check [repo:/path/to/repo] on [branch:main]";
        let result = expand_pill_references(msg, Path::new("/tmp"), None, &[]);
        // repo/branch are not expanded (no file content to inject)
        assert_eq!(result, msg);
    }

    #[test]
    fn test_pill_regex_matches() {
        let msg = "MAR-0014: New Work Item [file:project-1/MAR-0014]";
        let caps: Vec<_> = PILL_RE.captures_iter(msg).collect();
        assert_eq!(caps.len(), 1);
        assert_eq!(&caps[0][1], "file");
        assert_eq!(&caps[0][2], "project-1/MAR-0014");
    }
}
