//! LSP / Lint Cache (persisted to ~/.orgii/)
//!
//! Provides caching for LSP server and lint tool scan results.
//! Cached results are valid for 1 hour.

use serde::{Deserialize, Serialize};

#[cfg(test)]
#[path = "tests/cache_tests.rs"]
mod tests;

use super::discovery::LanguageServerInfo;
use crate::lint_tools::LintToolInfo;

const CACHE_MAX_AGE_SECS: u64 = 3600;

#[derive(Serialize, Deserialize)]
struct CachedLsp {
    scanned_at: String,
    servers: Vec<LanguageServerInfo>,
}

#[derive(Serialize, Deserialize)]
struct CachedLint {
    scanned_at: String,
    tools: Vec<LintToolInfo>,
}

fn lsp_path() -> std::path::PathBuf {
    app_paths::lsp_cache()
}

fn lint_path() -> std::path::PathBuf {
    app_paths::lint_cache()
}

fn is_fresh(scanned_at: &str) -> bool {
    let Ok(ts) = chrono::DateTime::parse_from_rfc3339(scanned_at) else {
        return false;
    };
    let age = chrono::Utc::now().signed_duration_since(ts).num_seconds() as u64;
    age < CACHE_MAX_AGE_SECS
}

pub fn save_lsp(servers: &[LanguageServerInfo]) {
    let cached = CachedLsp {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        servers: servers.to_vec(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cached) {
        let path = lsp_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, json);
    }
}

pub fn load_lsp() -> Option<Vec<LanguageServerInfo>> {
    // Silent `None` here merges three distinct cases: missing
    // (legitimate first run), unreadable (permission/disk fault),
    // and corrupt (torn write). Only the first should be quiet —
    // the other two will trigger a fresh rescan that may take 10+
    // seconds, and the operator deserves a hint why.
    let path = lsp_path();
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "lsp::cache::load_lsp: read failed; will rescan from scratch"
                );
            }
            return None;
        }
    };
    let cached: CachedLsp = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "lsp::cache::load_lsp: JSON parse failed (likely torn write); will rescan from scratch"
            );
            return None;
        }
    };
    if !is_fresh(&cached.scanned_at) {
        return None;
    }
    Some(cached.servers)
}

pub fn save_lint(tools: &[LintToolInfo]) {
    let cached = CachedLint {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        tools: tools.to_vec(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cached) {
        let path = lint_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, json);
    }
}

pub fn load_lint() -> Option<Vec<LintToolInfo>> {
    let path = lint_path();
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "lsp::cache::load_lint: read failed; will rescan from scratch"
                );
            }
            return None;
        }
    };
    let cached: CachedLint = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "lsp::cache::load_lint: JSON parse failed (likely torn write); will rescan from scratch"
            );
            return None;
        }
    };
    if !is_fresh(&cached.scanned_at) {
        return None;
    }
    Some(cached.tools)
}
