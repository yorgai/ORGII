//! Detector for Kiro artifacts.
//!
//! Covers:
//!   - `.kiro/steering/*.md`  → `Policy`

use std::path::Path;

use super::super::types::{DetectedItem, ItemKind, ItemPreview, SourceAgent, SourceScope};
use super::helpers::{
    first_body_line, orgii_target_exists, path_has_denied_ancestor, MAX_RULE_BYTES,
};
use crate::specialization::policies::PolicySource;

pub(super) fn detect_kiro_steering(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();
    let Some(repo) = repo_path else {
        return out;
    };

    let dir = repo.join(".kiro").join("steering");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if path_has_denied_ancestor(&path) {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.is_empty() {
            continue;
        }

        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size_bytes > MAX_RULE_BYTES {
            continue;
        }

        let suggested_name = format!("kiro-{}", stem);
        let already_imported =
            orgii_target_exists(PolicySource::Workspace, Some(repo), &suggested_name);

        out.push(DetectedItem {
            source_agent: SourceAgent::Kiro,
            source_scope: SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            kind: ItemKind::Policy,
            source_path: path.to_path_buf(),
            suggested_name,
            already_imported,
            fidelity_warnings: Vec::new(),
            preview: ItemPreview {
                summary: first_body_line(&raw),
                frontmatter: Vec::new(),
                size_bytes,
            },
        });
    }

    out
}
