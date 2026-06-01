//! Private helpers for skills loading.

use std::fs;
use std::path::{Path, PathBuf};

use super::commands::global_skills_dir;

/// Count tokens in a string using the shared BPE tokenizer.
pub(super) fn estimate_tokens(text: &str) -> usize {
    crate::model_context::tokenizer::count_tokens(text)
}

/// Count tokens for a skill's summary line in the prompt.
pub(super) fn estimate_summary_line_tokens(name: &str, description: &str) -> usize {
    let line = format!("- **{}** (source): {} [status]", name, description);
    crate::model_context::tokenizer::count_tokens(&line)
}

/// Recursively collect relative paths of all files in a skill directory
/// (excluding SKILL.md itself).
pub(super) fn collect_bundled_files(skill_dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_bundled_files_recursive(skill_dir, skill_dir, &mut files);
    files.sort();
    files
}

fn collect_bundled_files_recursive(base: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_bundled_files_recursive(base, &path, out);
        } else if path.file_name().map(|f| f != "SKILL.md").unwrap_or(false) {
            if let Ok(rel) = path.strip_prefix(base) {
                out.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

/// Resolve the skill directory for a given name, checking project then global.
pub(super) fn resolve_skill_dir(
    name: &str,
    workspace_path: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(pp) = workspace_path {
        let project_dir = PathBuf::from(pp).join(".orgii/skills").join(name);
        if project_dir.exists() {
            return Ok(project_dir);
        }
    }
    let global_dir = global_skills_dir().join(name);
    if global_dir.exists() {
        return Ok(global_dir);
    }
    Err(format!("Skill '{}' not found", name))
}

/// Validate a relative path is safe (no `..` or absolute paths).
pub(super) fn validate_relative_path(relative_path: &str) -> Result<(), String> {
    if relative_path.is_empty() {
        return Err("File path cannot be empty".to_string());
    }
    if relative_path.contains("..") || Path::new(relative_path).is_absolute() {
        return Err("File path must be relative and cannot contain '..'".to_string());
    }
    if relative_path == "SKILL.md" {
        return Err("Use skills_update to modify SKILL.md".to_string());
    }
    Ok(())
}
